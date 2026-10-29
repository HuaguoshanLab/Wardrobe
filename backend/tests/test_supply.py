from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from test_inventory import demand, save
from test_outfits import client, headers, wardrobe  # noqa: F401

from app.db.organization import SupplyLink, SupplySource
from app.db.session import session_factory
from app.db.wardrobe import Garment

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def make(**values):
    pid = values.pop("id", str(uuid4()))
    response = client.post(
        f"/api/v1/supply-plans/{pid}",
        headers=headers(),
        json={
            "expected_version": 0,
            "name": "补充通勤上装",
            "quantity": 2,
            **values,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def associate(plan, gid, key=None):
    garment = client.get(f"/api/v1/garments/{gid}").json()["data"]
    return client.post(
        f"/api/v1/supply-plans/{plan['id']}/link",
        headers=key or headers(),
        json={
            "expected_version": plan["version"],
            "garment_id": str(gid),
            "garment_version": garment["version"],
        },
    )


def test_planning_partial_duplicate_cancel_and_historical_fulfillment(wardrobe):  # noqa: F811
    plan = make(status="purchased", budget="0")
    with session_factory()() as db:
        before = [(g.id, g.version) for g in db.scalars(select(Garment))]
    key = headers()
    first = associate(plan, wardrobe[0], key)
    assert first.status_code == 200, first.text
    assert associate(plan, wardrobe[0], key).json()["data"] == first.json()["data"]
    plan = first.json()["data"]
    assert plan["remaining"] == 1 and plan["status"] == "purchased"
    assert associate(plan, wardrobe[0]).status_code == 409
    cancelled = client.post(
        f"/api/v1/supply-plans/{plan['id']}/cancel-remaining",
        headers=headers(),
        json={"expected_version": plan["version"]},
    )
    assert cancelled.status_code == 200
    final = cancelled.json()["data"]
    assert (final["status"], final["remaining"], final["cancelled_quantity"]) == ("completed", 0, 1)
    with session_factory().begin() as db:
        assert [(g.id, g.version) for g in db.scalars(select(Garment))] == before
        db.get(Garment, wardrobe[0]).ownership = "retired"
    final = client.get(f"/api/v1/supply-plans/{plan['id']}").json()["data"]
    assert final["linked"][0]["archived"] and final["status"] == "completed"


def test_shared_sources_survive_delete_and_never_duplicate_stock():
    a, b = demand(), demand()
    save([a])
    save([b], "autumn")
    plan = make(source_ids=[a["id"], b["id"]])
    save([])
    current = client.get(f"/api/v1/supply-plans/{plan['id']}").json()["data"]
    assert len(current["sources"]) == 2 and sum(s["active"] for s in current["sources"]) == 1
    with session_factory()() as db:
        original = db.get(SupplySource, (UUID(plan["id"]), UUID(a["id"])))
        assert original.snapshot["name"] == a["name"]
    assert (
        client.post(
            f"/api/v1/supply-plans/{uuid4()}",
            headers=headers(),
            json={
                "expected_version": 0,
                "name": "失效来源",
                "quantity": 1,
                "source_ids": [a["id"]],
            },
        ).status_code
        == 422
    )


def test_concurrent_fulfillment_same_garment_only_once_across_plans(wardrobe):  # noqa: F811
    plans = [make(quantity=1), make(quantity=1)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda p: associate(p, wardrobe[0]), plans))
    assert sorted(r.status_code for r in responses) == [200, 409]
    with session_factory()() as db:
        assert len(list(db.scalars(select(SupplyLink)))) == 1
    finished = next(r.json()["data"] for r in responses if r.status_code == 200)
    assert finished["status"] == "completed" and finished["remaining"] == 0


def test_versions_validation_cancel_and_reopen(wardrobe):  # noqa: F811
    pid = str(uuid4())
    key = headers()
    body = {"expected_version": 0, "name": "计划", "quantity": 2}
    first = client.post(f"/api/v1/supply-plans/{pid}", headers=key, json=body)
    assert first.status_code == 200
    assert (
        client.post(f"/api/v1/supply-plans/{pid}", headers=key, json=body).json()["data"]
        == first.json()["data"]
    )
    assert (
        client.post(f"/api/v1/supply-plans/{pid}", headers=headers(), json=body).status_code == 409
    )
    for quantity in [0, -1, True, 1.5]:
        assert (
            client.post(
                f"/api/v1/supply-plans/{pid}",
                headers=headers(),
                json={**body, "quantity": quantity},
            ).status_code
            == 422
        )
    plan = first.json()["data"]
    cancelled = client.post(
        f"/api/v1/supply-plans/{pid}/cancel-remaining",
        headers=headers(),
        json={"expected_version": plan["version"]},
    ).json()["data"]
    assert cancelled["status"] == "cancelled"
    assert associate(cancelled, wardrobe[0]).status_code == 409
    reopened = client.post(
        f"/api/v1/supply-plans/{pid}",
        headers=headers(),
        json={
            **body,
            "expected_version": cancelled["version"],
            "quantity": 1,
        },
    ).json()["data"]
    assert reopened["remaining"] == 1 and reopened["cancelled_quantity"] == 0
    done = associate(reopened, wardrobe[0]).json()["data"]
    assert done["status"] == "completed"
    with session_factory().begin() as db:
        db.get(Garment, wardrobe[1]).is_demo = True
    assert associate(make(), wardrobe[1]).status_code == 422


def test_two_distinct_links_complete_and_quantity_cannot_erase_fulfillment(wardrobe):  # noqa: F811
    p = make(quantity=2)
    p = associate(p, wardrobe[0]).json()["data"]
    p = associate(p, wardrobe[1]).json()["data"]
    assert p["status"] == "completed" and len(p["linked"]) == 2 and p["remaining"] == 0
    r = client.post(
        f"/api/v1/supply-plans/{p['id']}",
        headers=headers(),
        json={
            "expected_version": p["version"],
            "name": p["name"],
            "quantity": 1,
        },
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "FULFILLED_QUANTITY"
    first = client.get("/api/v1/supply-plans?limit=1").json()["data"]
    assert first["items"][0]["id"] == p["id"] and first["next_cursor"] is None
