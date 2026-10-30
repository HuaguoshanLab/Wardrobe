"""Initial facts survive review/confirmation without creating preview inventory."""

from uuid import UUID

import pytest
from sqlalchemy import func, select
from test_imports import batch, client, confirm, upload_photos

from app.db.lifecycle import GarmentSubtype
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.jobs.queue import claim
from app.jobs.worker import run_job

pytestmark = pytest.mark.integration


def ready():
    bid = upload_photos()["import_batch_id"]
    run_job(*claim())
    return bid, batch(bid)["rows"][0]


def patch(bid, row, changes):
    return client.patch(
        f"/api/v1/imports/{bid}/rows/{row['id']}",
        json={"expected_version": row["version"], "changes": changes},
    )


def test_details_confirm_and_replay(clean_db):
    bid, row = ready()
    changes = {
        "subtype_name": "自定义短袖",
        "condition": "good",
        "fit": "fits",
        "source": "gift",
        "acquired_on": "2026-01-01",
        "price": "0.00",
        "storage": "stored",
        "location": "衣柜第二层",
        "notes": "家人赠送",
    }
    response = patch(bid, row, changes)
    assert response.status_code == 200, response.text
    row = response.json()["data"]
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(Garment)) == 0
        assert db.scalar(select(func.count()).select_from(GarmentSubtype)) == 0
    saved = confirm(bid, [row], "details-confirm")
    assert saved.status_code == 200, saved.text
    gid = saved.json()["data"]["rows"][0]["garment_id"]
    assert confirm(bid, [row], "details-confirm").json()["data"] == saved.json()["data"]
    garment = client.get(f"/api/v1/garments/{gid}").json()["data"]
    assert garment["availability"] == "available" and garment["ownership"] == "owned"
    for k, v in changes.items():
        if k != "subtype_name":
            assert garment["lifecycle"][k] == v
    with session_factory()() as db:
        subtype = db.get(GarmentSubtype, UUID(garment["subtype_id"]))
        assert subtype.name == "自定义短袖" and subtype.category == "top"
        assert db.scalar(select(func.count()).select_from(Garment)) == 1
        assert "condition" not in db.get(Garment, UUID(gid)).attributes


@pytest.mark.parametrize(
    "changes",
    [
        {"price": "-1"},
        {"price": "1.001"},
        {"acquired_on": "2999-01-01"},
        {"condition": "excellent"},
        {"fit": "guess"},
        {"decision": "keep"},
        {"ownership": "retired"},
    ],
)
def test_invalid_initial_facts_are_rejected(clean_db, changes):
    bid, row = ready()
    response = patch(bid, row, changes)
    assert response.status_code == 422, response.text
    assert batch(bid)["rows"][0]["version"] == row["version"]


def test_unknowns_and_disabled_subtype(clean_db):
    bid, row = ready()
    assert row["draft"]["condition"] == "unknown" and row["draft"]["fit"] == "unknown"
    with session_factory().begin() as db:
        db.add(GarmentSubtype(category="top", name="旧分类", active=False))
    row = patch(bid, row, {"subtype_name": "旧分类"}).json()["data"]
    assert row["row_status"] == "invalid"
    assert confirm(bid, [row]).json()["data"]["rows"][0]["status"] == "invalid"
    row = patch(bid, row, {"subtype_name": None}).json()["data"]
    result = confirm(bid, [row]).json()["data"]["rows"][0]
    garment = client.get(f"/api/v1/garments/{result['garment_id']}").json()["data"]
    assert garment["lifecycle"]["condition"] == "unknown"
    assert garment["lifecycle"]["price"] is None and garment["subtype_id"] is None
