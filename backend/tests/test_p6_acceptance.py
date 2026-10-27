"""Exact acceptance combinations missing from the earlier feature-level coverage."""

import pytest
from sqlalchemy import select
from test_imports import batch, confirm, upload_photos
from test_outfits import client, generate, headers, session
from test_outfits import wardrobe as wardrobe

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.jobs.queue import claim
from app.jobs.worker import run_job
from app.media.images import demo_image
from app.schemas.recognition import RecognitionResult

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def local_images(monkeypatch):
    monkeypatch.setattr(get_settings(), "cutout_enabled", False)


def patch_row(bid, row, changes):
    response = client.patch(
        f"/api/v1/imports/{bid}/rows/{row['id']}",
        json={"expected_version": row["version"], "changes": changes},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def photos(count):
    return upload_photos([("files", (f"{i}.png", demo_image(), "image/png")) for i in range(count)])


def test_category_only_confirmation(clean_db, monkeypatch):
    def unavailable(*_):
        raise AppError("PROVIDER_NOT_CONFIGURED", "manual input", 503)

    monkeypatch.setattr("app.services.recognition.recognize", unavailable)
    accepted = photos(1)
    run_job(*claim())
    bid = accepted["import_batch_id"]
    row = patch_row(bid, batch(bid)["rows"][0], {"category": "top"})
    outcome = confirm(bid, [row]).json()["data"]["rows"][0]
    assert outcome["status"] == "confirmed"
    garment = client.get("/api/v1/garments/" + outcome["garment_id"]).json()["data"]
    assert garment["availability"] == "available" and garment["category"] == "top"
    for field in ("material", "thickness", "warmth", "name"):
        assert garment[field] is None
    for field in ("color_codes", "seasons", "occasion_codes", "style_codes", "custom_tag_ids"):
        assert garment[field] == []
    assert client.get(garment["image_url"]).status_code == 200


def test_three_photos_one_recognition_failure(clean_db, monkeypatch):
    calls = []

    def provider(*_):
        calls.append(1)
        if len(calls) == 2:
            raise AppError("INVALID_MODEL_OUTPUT", "injected single-row failure")
        return RecognitionResult.model_validate({"attributes": {"category": "top"}})

    monkeypatch.setattr("app.services.recognition.recognize", provider)
    accepted = photos(3)
    run_job(*claim())
    bid = accepted["import_batch_id"]
    rows = batch(bid)["rows"]
    assert [r["analysis_status"] for r in rows] == ["succeeded", "failed", "succeeded"]
    successful = [rows[0], rows[2]]
    assert all(r["status"] == "confirmed" for r in confirm(bid, successful).json()["data"]["rows"])
    fixed = patch_row(bid, rows[1], {"category": "shoes"})
    assert confirm(bid, [fixed]).json()["data"]["rows"][0]["status"] == "confirmed"
    assert len(calls) == 3
    assert len(client.get("/api/v1/garments").json()["data"]["items"]) == 3


def test_mixed_confirmation_is_atomic_per_row(clean_db):
    accepted = photos(3)
    run_job(*claim())
    bid = accepted["import_batch_id"]
    rows = batch(bid)["rows"]
    invalid = patch_row(bid, rows[1], {"category": None})
    fresh = patch_row(bid, rows[2], {"name": "changed after preview"})
    key = "p6-mixed-confirmation"
    response = confirm(bid, [rows[0], invalid, rows[2]], key).json()["data"]
    results = {r["row_id"]: r["status"] for r in response["rows"]}
    assert results == {
        rows[0]["id"]: "confirmed",
        rows[1]["id"]: "invalid",
        rows[2]["id"]: "version_conflict",
    }
    assert confirm(bid, [rows[0], invalid, rows[2]], key).json()["data"] == response
    assert len(client.get("/api/v1/garments").json()["data"]["items"]) == 1
    fixed = patch_row(bid, invalid, {"category": "top"})
    for row in (fixed, fresh):
        assert confirm(bid, [row]).json()["data"]["rows"][0]["status"] == "confirmed"
    assert len(client.get("/api/v1/garments").json()["data"]["items"]) == 3


def test_sparse_wardrobe_keeps_suggestions_separate(wardrobe):
    with session_factory().begin() as db:
        for garment in db.scalars(select(Garment)):
            if garment.id != wardrobe[0]:
                garment.attributes = {**garment.attributes, "availability": "unavailable"}
    saved, job = generate(session())
    assert len(saved["revisions"]) == 1
    assert job["result"]["outcome"] == "partial"
    items = saved["revisions"][0]["items"]
    owned = [i for i in items if i["source"] == "wardrobe"]
    suggestions = [i for i in items if i["source"] != "wardrobe"]
    assert [i["garment_id"] for i in owned] == [str(wardrobe[0])]
    assert suggestions and all(i["garment_id"] is None for i in suggestions)
    assert saved["revisions"][0]["unmet_requirements"]


def test_locked_occasion_conflict_is_explicit(wardrobe):
    with session_factory().begin() as db:
        g = db.get(Garment, wardrobe[-1])
        g.attributes = {**g.attributes, "occasion_codes": ["sport"], "name": "locked sport coat"}
    saved, _ = generate(session())
    old = next(r for r in saved["revisions"] if r["id"] == saved["selected_revision_id"])
    response = client.patch(
        f"/api/v1/outfit-sessions/{saved['id']}",
        headers=headers(),
        json={
            "expected_version": saved["version"],
            "locked_garment_ids": [str(wardrobe[-1])],
            "requirements": {
                "occasion_codes": ["formal"],
                "weather_override": {"temperature_c": 20, "condition": "clear"},
            },
        },
    )
    assert response.status_code == 200, response.text
    saved, job = generate(response.json()["data"])
    assert saved["locked_garment_ids"] == [str(wardrobe[-1])]
    for revision in saved["revisions"]:
        assert any(i["garment_id"] == str(wardrobe[-1]) for i in revision["items"])
        assert any(
            "locked sport coat" in text and "不匹配" in text
            for text in revision["unmet_requirements"]
        )
    assert job["result"]["outcome"] == "partial"
    assert client.get("/api/v1/outfit-revisions/" + old["id"]).json()["data"] == old


def test_deleted_snapshot_reuse_reports_invalid_item(wardrobe):
    saved, _ = generate(session())
    revision = saved["revisions"][0]
    item = next(i for i in revision["items"] if i["source"] == "wardrobe")
    image = client.get(item["image_url"]).content
    garment = client.get("/api/v1/garments/" + item["garment_id"]).json()["data"]
    deleted = client.delete(
        "/api/v1/garments/" + item["garment_id"], headers={"If-Match": str(garment["version"])}
    )
    assert deleted.status_code == 204
    reused = client.post(
        "/api/v1/outfit-sessions", headers=headers(), json={"base_revision_id": revision["id"]}
    )
    assert reused.status_code == 201
    assert item["garment_id"] in reused.json()["data"]["invalid_garment_ids"]
    assert reused.json()["data"]["current_job_id"] is None
    assert client.get("/api/v1/outfit-revisions/" + revision["id"]).json()["data"] == revision
    assert client.get(item["image_url"]).content == image


@pytest.mark.parametrize(
    "kind,field",
    [("import", "import_batch_id"), ("outfit", "revision_ids"), ("backup", "backup_id")],
)
def test_sse_result_type_and_terminal_replay(wardrobe, kind, field, monkeypatch, tmp_path):
    import json

    from test_backups import export

    monkeypatch.setattr(get_settings(), "control_root", tmp_path / "control")
    if kind == "import":
        accepted = photos(1)
        run_job(*claim())
        job_id = accepted["job_id"]
    elif kind == "outfit":
        _, job = generate(session())
        job_id = job["id"]
    else:
        record, _ = export()
        job_id = str(record.id)
    path = "/api/v1/jobs/" + job_id
    before = client.get(path).json()["data"]
    events = client.get(path + "/events")
    assert events.status_code == 200
    decoded = [
        json.loads(line[6:]) for line in events.text.splitlines() if line.startswith("data: ")
    ]
    results = [e["payload"] for e in decoded if e["type"] == "result"]
    assert len(results) == 1 and field in results[0]
    assert results[0] == before["result"]
    if kind != "outfit":
        assert "revision_ids" not in results[0]
    assert decoded[-1]["payload"]["status"] == "succeeded"
    assert client.get(path + f"/events?after_seq={before['last_seq']}").text == ""
    assert client.get(path).json()["data"] == before
