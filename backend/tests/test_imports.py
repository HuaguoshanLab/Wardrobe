import io
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import select

from app.db.models import Job, SystemState, utcnow
from app.db.session import session_factory
from app.db.wardrobe import Garment, ImportRow
from app.jobs.imports import run_step
from app.jobs.queue import claim, complete, sweep
from app.jobs.worker import run_job
from app.main import app
from app.media.excel import template
from app.media.images import demo_image
from app.services.jobs import cancel_job
from app.services.seed import seed_demo

pytestmark = pytest.mark.integration
client = TestClient(app)


def upload_photos(files=None, key=None):
    response = client.post(
        "/api/v1/imports/photos",
        headers={"Idempotency-Key": key or str(uuid4())},
        files=files or [("files", ("shirt.png", demo_image(), "image/png"))],
    )
    assert response.status_code == 202, response.text
    return response.json()["data"]


def batch(batch_id):
    return client.get(f"/api/v1/imports/{batch_id}").json()["data"]


def confirm(batch_id, rows, key=None):
    return client.post(
        f"/api/v1/imports/{batch_id}/confirm",
        headers={"Idempotency-Key": key or str(uuid4())},
        json={"rows": [{"row_id": r["id"], "expected_version": r["version"]} for r in rows]},
    )


def test_partial_photo_import_idempotency_and_original_retention(clean_db):
    key = str(uuid4())
    files = [
        ("files", ("valid.png", demo_image(), "image/png")),
        ("files", ("broken.png", b"bad", "image/png")),
    ]
    accepted = upload_photos(files, key)
    assert upload_photos(files, key) == accepted
    claim_value = claim()
    run_job(*claim_value)
    current = batch(accepted["import_batch_id"])
    assert current["job_status"] == "succeeded"
    valid, invalid = current["rows"]
    assert valid["analysis_source"] == "fake" and valid["has_cutout"]
    assert invalid["row_status"] == "invalid"
    confirm_key = str(uuid4())
    result = confirm(current["id"], current["rows"], confirm_key)
    assert result.status_code == 200
    assert {r["status"] for r in result.json()["data"]["rows"]} == {"confirmed", "invalid"}
    assert (
        confirm(current["id"], current["rows"], confirm_key).json()["data"] == result.json()["data"]
    )
    assert (
        confirm(current["id"], [valid]).json()["data"]["rows"][0]["status"] == "already_confirmed"
    )
    garment = client.get("/api/v1/garments").json()["data"]["items"][0]
    assert (
        client.delete(f"/api/v1/garments/{garment['id']}", headers={"If-Match": "1"}).status_code
        == 204
    )
    source = client.get(f"/api/v1/media/{garment['image_asset_id']}?variant=source")
    assert source.content == demo_image()
    assert client.get(f"/api/v1/garments/{garment['id']}").status_code == 404


def test_manual_clear_and_confirmed_attributes_win_against_late_ai(clean_db):
    accepted = upload_photos()
    job_id, token = claim()
    row = batch(accepted["import_batch_id"])["rows"][0]
    path = f"/api/v1/imports/{accepted['import_batch_id']}/rows/{row['id']}"
    run_step(job_id, token, UUID(row["id"]), "conversion")
    row = batch(accepted["import_batch_id"])["rows"][0]
    result = client.patch(
        path, json={"expected_version": row["version"], "changes": {"category": None}}
    )
    assert result.status_code == 200
    run_step(job_id, token, UUID(row["id"]), "analysis")
    row = batch(accepted["import_batch_id"])["rows"][0]
    assert row["draft"]["category"] is None
    result = client.patch(
        path, json={"expected_version": row["version"], "changes": {"category": "shoes"}}
    )
    assert result.status_code == 200
    row = result.json()["data"]
    assert (
        confirm(accepted["import_batch_id"], [row]).json()["data"]["rows"][0]["status"]
        == "confirmed"
    )
    run_step(job_id, token, UUID(row["id"]), "analysis")
    assert client.get("/api/v1/garments").json()["data"]["items"][0]["category"] == "shoes"


def test_excel_attributes_bypass_ai_and_invalid_row_is_editable(clean_db):
    book = load_workbook(io.BytesIO(template()))
    book["garments"]["B2"] = "unknown-category"
    book["garments"]["C2"] = "我的鞋"
    output = io.BytesIO()
    book.save(output)
    response = client.post(
        "/api/v1/imports/excel",
        headers={"Idempotency-Key": str(uuid4())},
        files={"file": ("clothes.xlsx", output.getvalue())},
    )
    assert response.status_code == 202
    batch_id = response.json()["data"]["import_batch_id"]
    run_job(*claim())
    row = batch(batch_id)["rows"][0]
    assert row["analysis_status"] == "not_requested" and row["analysis_source"] is None
    assert row["draft"]["name"] == "我的鞋" and row["row_status"] == "invalid"
    changed = client.patch(
        f"/api/v1/imports/{batch_id}/rows/{row['id']}",
        json={"expected_version": row["version"], "changes": {"category": "shoes"}},
    )
    assert changed.status_code == 200
    assert confirm(batch_id, [row]).json()["data"]["rows"][0]["status"] == "version_conflict"
    assert (
        confirm(batch_id, [changed.json()["data"]]).json()["data"]["rows"][0]["status"]
        == "confirmed"
    )


def test_interruption_exposed_and_explicit_step_retry(clean_db):
    accepted = upload_photos()
    job_id, token = claim()
    with session_factory().begin() as db:
        job = db.get(Job, job_id)
        job.heartbeat_at = utcnow() - timedelta(minutes=5)
    sweep()
    row = batch(accepted["import_batch_id"])["rows"][0]
    assert row["conversion_status"] == "interrupted"
    path = f"/api/v1/imports/{accepted['import_batch_id']}/rows/{row['id']}/retry"
    headers = {"Idempotency-Key": "retry-convert"}
    retry = client.post(path, json={"step": "conversion"}, headers=headers)
    assert retry.status_code == 202
    assert (
        client.post(path, json={"step": "conversion"}, headers=headers).json()["data"]
        == retry.json()["data"]
    )
    run_job(*claim())
    assert batch(accepted["import_batch_id"])["rows"][0]["conversion_status"] == "succeeded"
    complete(
        job_id,
        token,
        result={
            "import_batch_id": accepted["import_batch_id"],
            "row_counts": {},
            "failed_steps": 0,
        },
    )
    assert batch(accepted["import_batch_id"])["job_status"] == "interrupted"


def test_demo_deleted_once_not_reseeded(clean_db):
    with session_factory().begin() as db:
        db.scalar(select(SystemState)).demo_seeded_at = None
    seed_demo()
    garment = client.get("/api/v1/garments").json()["data"]["items"][0]
    assert garment["is_demo"]
    client.delete(f"/api/v1/garments/{garment['id']}", headers={"If-Match": "1"})
    seed_demo()
    assert client.get("/api/v1/garments").json()["data"]["items"] == []


def test_cancelled_batch_and_skipped_rows_never_enter_wardrobe(clean_db):
    accepted = upload_photos()
    cancel_job(UUID(accepted["job_id"]))
    row = batch(accepted["import_batch_id"])["rows"][0]
    assert row["conversion_status"] == "cancelled" and claim() is None
    path = f"/api/v1/imports/{accepted['import_batch_id']}/rows/{row['id']}"
    response = client.patch(
        path, json={"expected_version": row["version"], "changes": {}, "skip": True}
    )
    assert response.status_code == 200
    assert (
        confirm(accepted["import_batch_id"], [response.json()["data"]]).json()["data"]["rows"][0][
            "status"
        ]
        == "invalid"
    )
    with session_factory()() as db:
        assert db.scalar(select(Garment)) is None
        assert db.scalar(select(ImportRow)).skipped


def test_late_recognition_cannot_overwrite_concurrent_manual_edit(clean_db, monkeypatch):
    accepted = upload_photos()
    job_id, token = claim()
    row = batch(accepted["import_batch_id"])["rows"][0]
    run_step(job_id, token, UUID(row["id"]), "conversion")

    def late_result(_):
        current = batch(accepted["import_batch_id"])["rows"][0]
        response = client.patch(
            f"/api/v1/imports/{accepted['import_batch_id']}/rows/{row['id']}",
            json={
                "expected_version": current["version"],
                "changes": {"category": "shoes", "name": None},
            },
        )
        assert response.status_code == 200
        return {"category": "top", "name": "late guess"}, "fake"

    monkeypatch.setattr("app.jobs.imports.recognize", late_result)
    run_step(job_id, token, UUID(row["id"]), "analysis")
    current = batch(accepted["import_batch_id"])["rows"][0]
    assert current["draft"]["category"] == "shoes" and current["draft"]["name"] is None


def test_garment_edit_filters_tags_and_version_conflict(clean_db):
    accepted = upload_photos()
    run_job(*claim())
    current = batch(accepted["import_batch_id"])
    result = confirm(current["id"], current["rows"]).json()["data"]["rows"][0]
    path = f"/api/v1/garments/{result['garment_id']}"
    tag = client.post("/api/v1/tags", json={"name": "旅行"}).json()["data"]
    assert client.post("/api/v1/tags", json={"name": " 旅行 "}).json()["data"]["id"] == tag["id"]
    changed = client.patch(
        path,
        json={
            "expected_version": 1,
            "changes": {
                "name": "旅行鞋",
                "category": "shoes",
                "seasons": ["winter"],
                "availability": "unavailable",
                "custom_tag_ids": [tag["id"]],
                "display_variant": "original",
            },
        },
    )
    assert changed.status_code == 200
    assert changed.json()["data"]["image_url"].endswith("variant=original")
    assert (
        client.patch(path, json={"expected_version": 1, "changes": {"name": "stale"}}).status_code
        == 409
    )
    assert (
        client.patch(
            path, json={"expected_version": 2, "changes": {"category": "nonsense"}}
        ).status_code
        == 422
    )
    filtered = client.get(
        "/api/v1/garments",
        params={
            "q": "旅行",
            "season": "winter",
            "tag_id": tag["id"],
            "availability": "unavailable",
        },
    )
    assert len(filtered.json()["data"]["items"]) == 1
    assert client.get("/api/v1/garments?season=summer").json()["data"]["items"] == []
    assert client.delete(f"/api/v1/tags/{tag['id']}", headers={"If-Match": "1"}).status_code == 204
    latest = client.get(path).json()["data"]
    assert latest["custom_tag_ids"] == [] and latest["version"] == 3


def test_failed_recognition_allows_manual_confirmation(clean_db, monkeypatch):
    from app.core.errors import AppError

    def fail(_):
        raise AppError("PROVIDER_NOT_CONFIGURED", "请手动填写品类", 503)

    monkeypatch.setattr("app.jobs.imports.recognize", fail)
    accepted = upload_photos()
    run_job(*claim())
    current = batch(accepted["import_batch_id"])
    row = current["rows"][0]
    assert row["analysis_status"] == "failed" and row["image_url"]
    response = client.patch(
        f"/api/v1/imports/{current['id']}/rows/{row['id']}",
        json={"expected_version": row["version"], "changes": {"category": "top"}},
    )
    assert (
        confirm(current["id"], [response.json()["data"]]).json()["data"]["rows"][0]["status"]
        == "confirmed"
    )


def test_concurrent_confirmation_creates_one_garment(clean_db):
    from concurrent.futures import ThreadPoolExecutor

    from app.schemas.wardrobe import ConfirmInput
    from app.services.import_review import confirm as confirm_service

    accepted = upload_photos()
    run_job(*claim())
    current = batch(accepted["import_batch_id"])
    row = current["rows"][0]
    payload = ConfirmInput.model_validate(
        {"rows": [{"row_id": row["id"], "expected_version": row["version"]}]}
    )
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(
            pool.map(
                lambda _: confirm_service(UUID(current["id"]), payload, str(uuid4())), range(4)
            )
        )
    assert {r.rows[0].status for r in results} == {"confirmed", "already_confirmed"}
    with session_factory()() as db:
        assert len(db.scalars(select(Garment)).all()) == 1
