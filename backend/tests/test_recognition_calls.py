from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import Job
from app.db.recognition import RecognitionCall
from app.db.session import session_factory
from app.db.wardrobe import ImportRow
from app.jobs.imports import run_step
from app.jobs.queue import claim
from app.jobs.worker import run_job
from app.main import app
from app.media.images import demo_image
from app.schemas.recognition import RecognitionResult
from app.services.jobs import cancel_job

pytestmark = pytest.mark.integration
client = TestClient(app)


@pytest.fixture(autouse=True)
def configure(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "recognition_mode", "fake")
    monkeypatch.setattr(settings, "cutout_enabled", False)


def upload(count=1):
    result = client.post(
        "/api/v1/imports/photos",
        headers={"Idempotency-Key": str(uuid4())},
        files=[("files", (f"photo-{i}.png", demo_image(), "image/png")) for i in range(count)],
    )
    assert result.status_code == 202
    return result.json()["data"]


def rows(accepted):
    return client.get(f"/api/v1/imports/{accepted['import_batch_id']}").json()["data"]["rows"]


def valid():
    return RecognitionResult.model_validate(
        {"attributes": {"category": "shoes"}, "uncertainties": ["材质未知"]}
    )


def prepared():
    accepted = upload()
    job_id, token = claim()
    row_id = UUID(rows(accepted)[0]["id"])
    run_step(job_id, token, row_id, "conversion")
    return accepted, job_id, token, row_id


def test_replay_reuses_response_and_preserves_unknowns(clean_db, monkeypatch):
    accepted, job_id, token, row_id = prepared()
    calls = []

    def provider(*_):
        calls.append(1)
        return valid()

    monkeypatch.setattr("app.services.recognition.recognize", provider)
    run_step(job_id, token, row_id, "analysis")
    run_step(job_id, token, row_id, "analysis")
    assert len(calls) == 1
    row = rows(accepted)[0]
    assert row["draft"]["category"] == "shoes" and row["draft"]["material"] is None
    assert row["analysis_notes"] == ["材质未知"]
    with session_factory()() as db:
        call = db.get(RecognitionCall, (job_id, row_id))
        assert call.state == "received" and call.response
        assert "api_key" not in call.config


def test_sent_without_response_never_replayed(clean_db, monkeypatch):
    accepted, job_id, token, row_id = prepared()
    with session_factory().begin() as db:
        db.add(RecognitionCall(job_id=job_id, row_id=row_id, state="sent", config={"mode": "qwen"}))

    def forbidden(*_):
        pytest.fail("unknown call must not be sent again")

    monkeypatch.setattr("app.services.recognition.recognize", forbidden)
    run_step(job_id, token, row_id, "analysis")
    assert rows(accepted)[0]["analysis_status"] == "interrupted"


def test_partial_unknown_batch_and_explicit_idempotent_retry(clean_db, monkeypatch):
    accepted = upload(2)
    calls = []

    def provider(*_):
        calls.append(1)
        if len(calls) == 1:
            raise AppError("CALL_RESULT_UNKNOWN", "结果未知")
        return valid()

    monkeypatch.setattr("app.services.recognition.recognize", provider)
    run_job(*claim())
    current = rows(accepted)
    assert [r["analysis_status"] for r in current] == ["interrupted", "succeeded"]
    job = client.get(f"/api/v1/jobs/{accepted['job_id']}").json()["data"]
    assert job["status"] == "interrupted" and job["result"]["interrupted_rows"] == 1
    for _ in range(2):
        rows(accepted)
    assert len(calls) == 2
    path = f"/api/v1/imports/{accepted['import_batch_id']}/rows/{current[0]['id']}/retry"
    headers = {"Idempotency-Key": str(uuid4())}
    retry = client.post(path, json={"step": "analysis"}, headers=headers)
    assert retry.status_code == 202
    assert (
        client.post(path, json={"step": "analysis"}, headers=headers).json()["data"]
        == retry.json()["data"]
    )
    run_job(*claim())
    assert len(calls) == 3 and rows(accepted)[0]["analysis_status"] == "succeeded"
    with session_factory()() as db:
        assert len(db.scalars(select(RecognitionCall)).all()) == 3


def test_cancellation_during_request_keeps_ledger_not_draft(clean_db, monkeypatch):
    accepted = upload()

    def provider(*_):
        cancel_job(UUID(accepted["job_id"]))
        return valid()

    monkeypatch.setattr("app.services.recognition.recognize", provider)
    run_job(*claim())
    row = rows(accepted)[0]
    assert row["draft"]["category"] is None
    with session_factory()() as db:
        assert db.get(Job, UUID(accepted["job_id"])).status == "cancelled"
        assert db.scalar(select(RecognitionCall)).response is not None


def test_twenty_rows_one_attempt_each_and_config_drift(clean_db, monkeypatch):
    accepted = upload(20)
    calls = []

    def provider(*_):
        calls.append(1)
        return valid()

    monkeypatch.setattr("app.services.recognition.recognize", provider)
    run_job(*claim())
    assert len(calls) == 20 and len(rows(accepted)) == 20
    next_batch = upload()
    monkeypatch.setattr(get_settings(), "recognition_mode", "qwen")
    run_job(*claim())
    assert "PROVIDER_CONFIG_CHANGED" in rows(next_batch)[0]["processing_errors"]["analysis"]
    assert len(calls) == 20


def test_confirmed_during_request_cannot_change_garment(clean_db, monkeypatch):
    accepted, job_id, token, row_id = prepared()

    def provider(*_):
        row = rows(accepted)[0]
        changed = client.patch(
            f"/api/v1/imports/{accepted['import_batch_id']}/rows/{row_id}",
            json={"expected_version": row["version"], "changes": {"category": "top"}},
        ).json()["data"]
        confirmed = client.post(
            f"/api/v1/imports/{accepted['import_batch_id']}/confirm",
            headers={"Idempotency-Key": str(uuid4())},
            json={"rows": [{"row_id": str(row_id), "expected_version": changed["version"]}]},
        )
        assert confirmed.json()["data"]["rows"][0]["status"] == "confirmed"
        return valid()

    monkeypatch.setattr("app.services.recognition.recognize", provider)
    run_step(job_id, token, row_id, "analysis")
    assert rows(accepted)[0]["draft"]["category"] == "top"
    with session_factory()() as db:
        assert db.get(ImportRow, row_id).confirmed_garment_id


def test_qwen_http_to_review_and_manual_priority(clean_db, monkeypatch):
    import json

    import httpx
    import respx

    settings = get_settings()
    monkeypatch.setattr(settings, "recognition_mode", "qwen")
    monkeypatch.setattr(
        settings, "qwen_base_url", "https://example.aliyuncs.com/compatible-mode/v1"
    )
    from pydantic import SecretStr

    monkeypatch.setattr(settings, "qwen_api_key", SecretStr("test-secret"))
    accepted = upload()
    with respx.mock:
        route = respx.post(settings.qwen_base_url + "/chat/completions").mock(
            return_value=httpx.Response(
                200, json={"choices": [{"message": {"content": json.dumps(valid().model_dump())}}]}
            )
        )
        run_job(*claim())
        assert route.call_count == 1
    row = rows(accepted)[0]
    assert row["analysis_source"] == "qwen" and row["draft"]["category"] == "shoes"
    state = client.get("/api/v1/capabilities").json()["data"]
    assert state["recognition"] == "configured" and state["model"] == "fake"


def test_backup_preserves_recognition_ledger_and_notes(clean_db, tmp_path, monkeypatch):
    from app.backup import archive, control, database, workflow
    from app.schemas.backups import RestoreApply
    from app.services import backups

    monkeypatch.setattr(get_settings(), "control_root", tmp_path / "control")
    monkeypatch.setattr("app.services.recognition.recognize", lambda *_: valid())
    accepted = upload()
    run_job(*claim())
    # Conversion retries replace the current display key; the call still owns its old image.
    from app.db.wardrobe import MediaAsset
    from app.media.storage import path_for, store_bytes

    with session_factory().begin() as db:
        call = db.scalar(select(RecognitionCall))
        old_key = call.config["display_key"]
        row = db.get(ImportRow, UUID(rows(accepted)[0]["id"]))
        media = db.get(MediaAsset, row.image_asset_id)
        replacement, _ = store_bytes(demo_image(), "display")
        media.display_key = replacement
    assert replacement != old_key
    backup = backups.create(str(uuid4()))
    workflow.process(control.require(backup.job_id))
    path = backups.download(backup.job_id)
    data, _ = archive.validate_archive(path, tmp_path / "unpack")
    assert old_key in database.media_keys(data)
    assert (tmp_path / "unpack" / "media" / old_key).read_bytes() == path_for(old_key).read_bytes()
    assert len(data["public.recognition_calls"]) == 1
    assert data["public.import_rows"][0]["analysis_notes"] == ["材质未知"]
    upload_path = tmp_path / "restore.zip"
    upload_path.write_bytes(path.read_bytes())
    view = backups.accept_upload(upload_path, str(uuid4()))
    workflow.process(control.require(view.restore_id))
    view = backups.restore_view(view.restore_id)
    assert view.status == "ready"
    with session_factory().begin() as db:
        db.query(RecognitionCall).delete()
        db.get(ImportRow, UUID(rows(accepted)[0]["id"])).analysis_notes = []
    backups.apply(
        view.restore_id, RestoreApply(confirmation_token=view.confirmation_token), str(uuid4())
    )
    workflow.process(control.require(view.restore_id))
    assert control.require(view.restore_id).status == "succeeded"
    restored = tmp_path / "restored.json"
    database.export_data(restored)
    actual = database.load_data(restored)
    assert actual["public.recognition_calls"] == data["public.recognition_calls"]
    assert rows(accepted)[0]["analysis_notes"] == ["材质未知"]
