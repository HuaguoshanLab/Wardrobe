"""Legacy imports and optional facts survive real backup restoration."""

from uuid import UUID, uuid4

import pytest
from test_backups import confirm as restore_confirm
from test_backups import export, validate
from test_import_details import patch, ready
from test_import_excel_details import workbook
from test_imports import batch, client, confirm

from app.backup import archive, control, workflow
from app.core.config import get_settings
from app.db.session import session_factory
from app.db.wardrobe import Garment, ImportRow
from app.jobs.queue import claim
from app.jobs.worker import run_job

pytestmark = pytest.mark.integration


def test_v1_confirm_retains_unknown_initial_facts(clean_db):
    response = client.post(
        "/api/v1/imports/excel",
        headers={"Idempotency-Key": str(uuid4())},
        files={"file": ("legacy.xlsx", workbook(version=1))},
    )
    bid = response.json()["data"]["import_batch_id"]
    run_job(*claim())
    row = batch(bid)["rows"][0]
    assert row["analysis_status"] == "not_requested"
    gid = confirm(bid, [row]).json()["data"]["rows"][0]["garment_id"]
    garment = client.get(f"/api/v1/garments/{gid}").json()["data"]
    assert garment["lifecycle"]["fit"] == "unknown"
    assert garment["lifecycle"]["condition"] == "unknown"
    assert garment["lifecycle"]["price"] is None and garment["subtype_id"] is None


def test_initial_facts_draft_and_inventory_survive_backup(clean_db, tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "control_root", tmp_path / "control")
    bid, row = ready()
    row = patch(
        bid,
        row,
        {
            "subtype_name": "备份短袖",
            "condition": "good",
            "fit": "fits",
            "price": "0.00",
            "location": "第二层",
            "seasons": ["spring"],
        },
    ).json()["data"]
    gid = confirm(bid, [row]).json()["data"]["rows"][0]["garment_id"]
    garment_before = client.get(f"/api/v1/garments/{gid}").json()["data"]
    pending_bid, pending = ready()
    patch(pending_bid, pending, {"notes": "未入库草稿", "source": "gift"})
    draft_before = batch(pending_bid)["rows"][0]
    inventory = client.post(
        "/api/v1/inventory/spring",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "expected_version": 0,
            "rows": [
                {
                    "id": str(uuid4()),
                    "name": "短袖需求",
                    "category": "top",
                    "subtype_ids": [garment_before["subtype_id"]],
                    "lower": 1,
                    "upper": 2,
                }
            ],
        },
    )
    assert inventory.status_code == 200, inventory.text
    before = client.get("/api/v1/inventory/spring").json()["data"]
    assert before["counts"][0]["confirmed"] == 1 and before["counts"][0]["pending"] == 0
    _, path = export()
    old_compatibility = {**archive.compatibility(), "app_version": "0.6.0-p7.1"}
    with monkeypatch.context() as previous_app:
        previous_app.setattr(archive, "compatibility", lambda: old_compatibility)
        assert validate(path).status == "invalid"  # Old apps must reject expanded draft JSON.
    view = validate(path)
    with session_factory().begin() as db:
        db.get(Garment, UUID(gid)).lifecycle = {}
        db.get(ImportRow, UUID(pending["id"])).draft = {}
    workflow.process(restore_confirm(view))
    assert control.require(view.restore_id).status == "succeeded"
    assert client.get(f"/api/v1/garments/{gid}").json()["data"] == garment_before
    assert batch(pending_bid)["rows"][0]["draft"] == draft_before["draft"]
    after = client.get("/api/v1/inventory/spring").json()["data"]
    for key in ("plan", "counts", "garments", "total_owned"):
        assert after[key] == before[key]
