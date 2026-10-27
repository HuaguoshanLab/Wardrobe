"""Controlled ENOSPC/SQL disk-full injection; no host filesystem is filled."""

import errno
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from test_backups import confirm, export, validate
from test_outfits import client, generate, headers, session, wardrobe  # noqa: F401

from app.backup import archive, control, database, workflow
from app.core.config import get_settings
from app.core.maintenance import active, exclusive
from app.services import backups

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


@pytest.fixture(autouse=True)
def controls(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "control_root", tmp_path / "control")


def enospc(*args, **kwargs):
    raise OSError(errno.ENOSPC, "injected isolated disk full")


def snapshot(tmp_path):
    output = tmp_path / "snapshot.json"
    database.export_data(output)
    data = database.load_data(output)
    rows = {name: sorted(map(str, values)) for name, values in data.items()}
    images = {key: archive.sha256(archive.path_for(key)) for key in database.media_keys(data)}
    return rows, images


@pytest.mark.parametrize("phase", ["export", "extract", "recovery", "media", "database"])
def test_disk_full_preserves_target_and_releases_gate(phase, tmp_path, monkeypatch):
    generate(session())
    _, path = export()
    before = snapshot(tmp_path)
    if phase == "export":
        record = control.require(backups.create(str(uuid4())).job_id)
    elif phase == "extract":
        upload = tmp_path / "input.zip"
        upload.write_bytes(path.read_bytes())
        record = control.require(backups.accept_upload(upload, str(uuid4())).restore_id)
    else:
        record = confirm(validate(path))
    with monkeypatch.context() as patch:
        if phase == "export":
            patch.setattr(Path, "write_bytes", enospc)
        elif phase == "extract":
            patch.setattr(archive.shutil, "copyfileobj", enospc)
        elif phase == "recovery":

            def fail_recovery(directory, filename="backup.zip"):
                assert filename == "recovery.zip"
                return enospc()

            patch.setattr(archive, "export_archive", fail_recovery)
        elif phase == "media":
            original_install = archive.install_media

            def fail_media(directory, data):
                with monkeypatch.context() as inner:
                    inner.setattr(archive, "path_for", lambda key: tmp_path / "new-media" / key)
                    inner.setattr(archive.shutil, "copyfileobj", enospc)
                    original_install(directory, data)

            patch.setattr(archive, "install_media", fail_media)
        else:
            original_import = database.import_data

            def full_database(connection, data):
                # Raise after real TRUNCATE/INSERT, inside switch_data's real transaction.
                original_import(connection, data)
                if connection.info.dbname.endswith("_test"):
                    raise psycopg.errors.DiskFull("isolated SQLSTATE 53100 injection")

            patch.setattr(database, "import_data", full_database)
        workflow.process(record)
    result = control.require(record.id)
    assert result.status == ("invalid" if phase == "extract" else "failed")
    assert not active()
    assert snapshot(tmp_path) == before
    # A new explicit attempt succeeds once storage is available again.
    retry = confirm(validate(path))
    workflow.process(retry)
    assert control.require(retry.id).status == "succeeded"
    assert not active()


@pytest.mark.parametrize("committed", [False, True])
def test_control_storage_failure_recovered_from_persisted_epoch(committed, tmp_path, monkeypatch):
    generate(session())
    _, path = export()
    record = confirm(validate(path))
    before = snapshot(tmp_path)
    old_epoch = database.data_epoch()
    original_switch = database.switch_data
    original_atomic = control.atomic

    def fail_state(path, data):
        if path.name == "state.json":
            return enospc()
        return original_atomic(path, data)

    def switch_then_fill(data, epoch):
        if committed:
            original_switch(data, epoch)
        monkeypatch.setattr(control, "atomic", fail_state)
        enospc()

    with monkeypatch.context() as patch:
        patch.setattr(database, "switch_data", switch_then_fill)
        with pytest.raises(OSError) as error:
            workflow.process(record)
        assert error.value.errno == errno.ENOSPC
    monkeypatch.setattr(control, "atomic", original_atomic)
    persisted = control.require(record.id)
    assert persisted.status == "running" and persisted.phase == "switching"
    # Same audit performed by controller startup after disk capacity is restored.
    with exclusive():
        workflow.recover(persisted)
    result = control.require(record.id)
    assert result.status == ("succeeded" if committed else "interrupted")
    assert (database.data_epoch() != old_epoch) == committed
    after = snapshot(tmp_path)
    assert after[1] == before[1]
    assert {k: v for k, v in after[0].items() if k != "public.system_state"} == {
        k: v for k, v in before[0].items() if k != "public.system_state"
    }
    if not committed:
        assert after == before
    assert not active()


def test_control_record_creation_disk_full_does_not_modify_target(tmp_path, monkeypatch):
    before = snapshot(tmp_path)
    with monkeypatch.context() as patch:
        patch.setattr(control, "atomic", enospc)
        with pytest.raises(OSError):
            backups.create(str(uuid4()))
    assert snapshot(tmp_path) == before
    assert not active()


def test_uploaded_archive_missing_image_never_modifies_target(tmp_path):
    from zipfile import ZipFile

    generate(session())
    _, path = export()
    before = snapshot(tmp_path)
    broken = tmp_path / "missing-image.zip"
    with ZipFile(path) as source, ZipFile(broken, "w") as target:
        missing = next(name for name in source.namelist() if name.startswith("media/"))
        for entry in source.infolist():
            if entry.filename != missing:
                target.writestr(entry, source.read(entry.filename))
    view = validate(broken)
    assert view.status == "invalid"
    assert view.confirmation_token is None
    assert snapshot(tmp_path) == before
    assert not active()
