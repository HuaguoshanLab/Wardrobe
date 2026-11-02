import pytest
from sqlalchemy import func, select
from test_backups import confirm, export, validate
from test_care import ROOT, batch, item, read
from test_outfits import client, headers, wardrobe  # noqa: F401

from app.backup import control, database, workflow
from app.core.config import get_settings
from app.core.maintenance import exclusive
from app.db.lifecycle import LifecycleEvent
from app.db.session import session_factory

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_care_receipts_and_events_survive_full_backup_restore(wardrobe, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(get_settings(), "control_root", tmp_path / "control")
    gid = wardrobe[0]
    body, key = [item(gid)], headers()
    outcome = batch(body, key).json()["data"]
    before = read(gid)
    _, path = export()
    view = validate(path)
    epoch = database.data_epoch()
    assert batch([item(gid, "wash_done", 2)]).json()["data"]["items"][0]["success"]
    workflow.process(confirm(view))
    assert control.require(view.restore_id).status == "succeeded"
    assert database.data_epoch() != epoch
    assert read(gid) == before
    assert batch(body, key).json()["data"] == outcome
    assert batch(body).json()["data"] == outcome
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(LifecycleEvent)) == 1


def test_care_respects_maintenance_barrier(wardrobe, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(get_settings(), "control_root", tmp_path / "control")
    with exclusive():
        assert client.get(ROOT).status_code == 503
        assert batch([item(wardrobe[0])]).status_code == 503
    assert read(wardrobe[0])["version"] == 1
