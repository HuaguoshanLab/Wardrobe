"""Process-level recognition interruption and backup compatibility boundaries."""

import json
import os
import subprocess
import sys
from datetime import timedelta
from uuid import UUID, uuid4
from zipfile import ZipFile

import pytest
from test_recognition_calls import prepared, rows, upload

from app.backup import archive, control, workflow
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import Job, utcnow
from app.db.recognition import RecognitionCall
from app.db.session import session_factory
from app.jobs.queue import claim, sweep
from app.jobs.worker import run_job
from app.services import backups

pytestmark = pytest.mark.integration


def test_process_exit_after_send_mark_needs_explicit_retry(clean_db, monkeypatch):
    monkeypatch.setattr(get_settings(), "recognition_mode", "fake")
    accepted, job_id, token, row_id = prepared()
    code = """
import os
from uuid import UUID
from app.jobs.imports import run_step
import app.services.recognition as service
def crash(*args):
    os._exit(77)
service.recognize = crash
run_step(UUID(os.environ['JOB_ID']), UUID(os.environ['LEASE_TOKEN']),
         UUID(os.environ['ROW_ID']), 'analysis')
"""
    process = subprocess.run(
        [sys.executable, "-c", code],
        env={
            **os.environ,
            "JOB_ID": str(job_id),
            "LEASE_TOKEN": str(token),
            "ROW_ID": str(row_id),
            "WARDROBE_RECOGNITION_MODE": "fake",
        },
        capture_output=True,
        timeout=30,
    )
    assert process.returncode == 77, process.stderr.decode()
    with session_factory().begin() as db:
        call = db.get(RecognitionCall, (job_id, row_id))
        assert call.state == "sent" and call.response is None
        db.get(Job, job_id).heartbeat_at = utcnow() - timedelta(minutes=5)
    sweep()
    assert rows(accepted)[0]["analysis_status"] == "interrupted"
    assert claim() is None  # The queue does not re-submit the unacknowledged call.


def test_previous_backup_version_rejected_without_change(clean_db, tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "recognition_mode", "fake")
    monkeypatch.setattr(get_settings(), "cutout_enabled", False)
    monkeypatch.setattr(get_settings(), "control_root", tmp_path / "control")
    accepted = upload()
    run_job(*claim())
    backup = backups.create(str(uuid4()))
    workflow.process(control.require(backup.job_id))
    path = backups.download(backup.job_id)
    old = tmp_path / "p5.zip"
    with ZipFile(path) as source, ZipFile(old, "w") as target:
        manifest = json.loads(source.read("manifest.json"))
        manifest.update(app_version="0.1.0-p5", alembic_revision="0005_collections")
        for name in source.namelist():
            target.writestr(
                name, json.dumps(manifest) if name == "manifest.json" else source.read(name)
            )
    before = rows(accepted)
    with pytest.raises(AppError) as exc:
        archive.validate_archive(old, tmp_path / "extract")
    assert exc.value.code == "INCOMPATIBLE_BACKUP"
    assert rows(accepted) == before
    with session_factory()() as db:
        assert db.get(Job, UUID(accepted["job_id"])).status == "succeeded"
