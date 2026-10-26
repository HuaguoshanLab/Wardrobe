import json
import os
import subprocess
import sys
from datetime import timedelta
from uuid import UUID, uuid4
from zipfile import ZipFile

import pytest
from test_outfits import client, generate, headers, session, wardrobe  # noqa: F401

from app.backup import archive, control, database, workflow
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.maintenance import active, exclusive, shared
from app.db.models import Job
from app.db.outfits import OutfitRevision
from app.db.session import session_factory
from app.schemas.backups import RestoreApply
from app.services import backups

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


@pytest.fixture(autouse=True)
def controls(tmp_path, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "control_root", tmp_path / "control")
    return settings


def export():
    accepted = backups.create(str(uuid4()))
    record = control.require(accepted.job_id)
    workflow.process(record)
    record = control.require(record.id)
    assert record.status == "succeeded", record.message
    return record, backups.download(record.id)


def validate(path):
    uploaded = path.parent / f"upload-{uuid4()}.zip"
    uploaded.write_bytes(path.read_bytes())
    view = backups.accept_upload(uploaded, str(uuid4()))
    workflow.process(control.require(view.restore_id))
    return backups.restore_view(view.restore_id)


def confirm(view):
    assert view.status == "ready", view.message
    payload = RestoreApply(confirmation_token=view.confirmation_token)
    key = str(uuid4())
    accepted = backups.apply(view.restore_id, payload, key)
    assert backups.apply(view.restore_id, payload, key) == accepted
    return control.require(view.restore_id)


def test_complete_backup_restore_and_control_events():
    s, _ = generate(session())
    rid = s["selected_revision_id"]
    before = client.get(f"/api/v1/outfit-revisions/{rid}").json()["data"]
    image = next(i["image_url"] for i in before["items"] if i["image_url"])
    pixels = client.get(image).content
    client.post(
        "/api/v1/favorites", headers=headers(), json={"revision_id": rid, "name": "备份收藏"}
    )
    pending = client.post(
        f"/api/v1/outfit-sessions/{s['id']}/generate",
        headers=headers(),
        json={"expected_version": s["version"]},
    ).json()["data"]["job_id"]
    record, path = export()
    events = client.get(f"/api/v1/jobs/{record.id}/events")
    assert events.status_code == 200 and "backup_id" in events.text
    old_epoch = database.data_epoch()
    view = validate(path)
    with session_factory().begin() as db:
        db.get(OutfitRevision, UUID(rid)).reason = "changed test data"
    workflow.process(confirm(view))
    result = control.require(view.restore_id)
    assert result.status == "succeeded", result.message
    assert database.data_epoch() != old_epoch
    assert client.get(f"/api/v1/outfit-revisions/{rid}").json()["data"] == before
    assert client.get(image).content == pixels
    assert client.get("/api/v1/favorites").json()["data"]["items"][0]["name"] == "备份收藏"
    with session_factory()() as db:
        assert db.get(Job, UUID(pending)).status == "interrupted"
        assert db.get(Job, UUID(pending)).lease_token is None
    assert (control.directory(view.restore_id) / "recovery.zip").is_file()
    expected, _ = archive.validate_archive(path, path.parent / "compare")
    restored_path = path.parent / "restored-data.json"
    database.export_data(restored_path)
    actual = database.load_data(restored_path)
    for table in expected.keys() - {"public.system_state", "public.jobs", "public.job_events"}:

        def canonical(rows):
            return sorted(json.dumps(row, sort_keys=True) for row in rows)

        assert canonical(actual[table]) == canonical(expected[table]), table
    assert not active()


def test_invalid_archive_never_changes_target():
    generate(session())
    _, path = export()
    original = database.data_epoch()
    bad = path.parent / "bad.zip"
    with ZipFile(path) as source, ZipFile(bad, "w") as target:
        for name in source.namelist():
            target.writestr(name, b"corrupted" if name == "database.json" else source.read(name))
    view = validate(bad)
    assert view.status == "invalid"
    assert database.data_epoch() == original
    assert view.confirmation_token is None
    with pytest.raises(AppError):
        backups.apply(
            view.restore_id, RestoreApply(confirmation_token="invalid-token-000000"), str(uuid4())
        )


def test_isolated_database_rejects_invalid_foreign_key():
    s, _ = generate(session())
    _, path = export()
    bad = path.parent / "bad-rows.zip"
    with ZipFile(path) as source:
        data = json.loads(source.read("database.json"))
        data["public.outfit_revisions"][0]["session_id"] = str(uuid4())
        body = json.dumps(data).encode()
        manifest = json.loads(source.read("manifest.json"))
        manifest["files"]["database.json"] = {"size": len(body), "sha256": control.digest(body)}
        with ZipFile(bad, "w") as target:
            for name in source.namelist():
                target.writestr(
                    name,
                    body
                    if name == "database.json"
                    else json.dumps(manifest).encode()
                    if name == "manifest.json"
                    else source.read(name),
                )
    assert validate(bad).status == "invalid"
    assert client.get(f"/api/v1/outfit-revisions/{s['selected_revision_id']}").status_code == 200


def test_maintenance_blocks_writes_and_waits_for_shared_holder():
    with exclusive():
        response = client.post("/api/v1/outfit-sessions", headers=headers(), json={})
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "MAINTENANCE_MODE"
        assert client.get("/api/v1/capabilities").json()["data"]["maintenance"]
        assert client.get("/api/v1/weather/cities?q=北京").status_code == 503
        with pytest.raises(AppError):
            with shared():
                pass
    with shared():
        with pytest.raises(AppError):
            with exclusive(timeout=0):
                pass
    assert not active()


@pytest.mark.parametrize("phase", ["before", "after"])
def test_process_death_at_database_switch_recovers_from_epoch(phase, controls):
    generate(session())
    _, path = export()
    record = confirm(validate(path))
    old_epoch = database.data_epoch()
    code = """
import os
from uuid import UUID
from app.backup import control, database, workflow
original = database.switch_data
def crash(data, epoch):
    if os.environ['CRASH_PHASE'] == 'after':
        original(data, epoch)
    os._exit(77)
database.switch_data = crash
workflow.process(control.require(UUID(os.environ['RESTORE_ID'])))
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        env={
            **os.environ,
            "WARDROBE_CONTROL_ROOT": str(controls.control_root),
            "CRASH_PHASE": phase,
            "RESTORE_ID": str(record.id),
        },
        capture_output=True,
        timeout=120,
    )
    assert result.returncode == 77, result.stderr.decode()
    assert active()  # Real process death must leave the persistent maintenance gate.
    with exclusive():
        workflow.recover(control.require(record.id))
    recovered = control.require(record.id)
    assert recovered.status == ("succeeded" if phase == "after" else "interrupted")
    assert (database.data_epoch() == old_epoch) == (phase == "before")
    assert not active()


def test_expired_token_and_missing_media():
    generate(session())
    _, path = export()
    view = validate(path)
    record = control.require(view.restore_id)
    record.expires_at -= timedelta(days=1)
    control.save(record)
    with pytest.raises(AppError) as error:
        confirm(view)
    assert error.value.code == "RESTORE_EXPIRED"
    with pytest.raises(AppError):
        archive.safe_key("../private/key")


def test_restore_into_empty_test_business_data_and_reinstalls_missing_media():
    from sqlalchemy import text

    from app.media.storage import path_for

    s, _ = generate(session())
    _, path = export()
    data, _ = archive.validate_archive(path, path.parent / "test-extracted")
    keys = database.media_keys(data)
    view = validate(path)
    # clean_db already guards the _test database name and explicit test environment.
    with session_factory().begin() as db:
        db.execute(
            text(
                "TRUNCATE jobs, garments, media_assets, import_batches, import_rows, "
                "tags, operation_receipts CASCADE"
            )
        )
    for key in keys:
        path_for(key).unlink(missing_ok=True)
    workflow.process(confirm(view))
    assert control.require(view.restore_id).status == "succeeded"
    assert client.get(f"/api/v1/outfit-revisions/{s['selected_revision_id']}").status_code == 200
    assert all(path_for(key).is_file() for key in keys)


def test_missing_reference_prevents_backup_publication():
    from sqlalchemy import select

    from app.db.wardrobe import MediaAsset
    from app.media.storage import path_for

    generate(session())
    with session_factory()() as db:
        media = db.scalar(select(MediaAsset))
        path_for(media.original_key).unlink()
    accepted = backups.create(str(uuid4()))
    workflow.process(control.require(accepted.job_id))
    record = control.require(accepted.job_id)
    assert record.status == "failed"
    assert record.error.code == "MEDIA_MISSING"
    with pytest.raises(AppError):
        backups.download(record.id)
    assert not active()
