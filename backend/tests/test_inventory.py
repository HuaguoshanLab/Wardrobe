from concurrent.futures import ThreadPoolExecutor
from time import perf_counter
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select
from test_outfits import client, headers, wardrobe  # noqa: F401

from app.db.inventory import InventoryDemand, InventoryPlan
from app.db.models import utcnow
from app.db.session import get_engine, session_factory
from app.db.wardrobe import Garment
from app.schemas.wardrobe import Attributes
from app.services import inventory

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def demand(**values):
    return {
        "id": str(uuid4()),
        "name": "夏季上装",
        "category": "top",
        "lower": 3,
        "upper": 5,
        **values,
    }


def read(season="summer"):
    response = client.get(f"/api/v1/inventory/{season}")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def save(rows, season="summer", version=None, key=None):
    return client.post(
        f"/api/v1/inventory/{season}",
        headers=key or headers(),
        json={
            "expected_version": read(season)["plan"]["version"] if version is None else version,
            "rows": rows,
        },
    )


def prepare(ids):
    with session_factory().begin() as db:
        for gid in ids:
            g = db.get(Garment, gid)
            g.attributes = {
                **g.attributes,
                "seasons": ["summer", "autumn"],
                "occasion_codes": ["work"],
            }
            g.lifecycle = {"condition": "good", "fit": "fits"}


def test_config_crud_zero_unknown_sort_and_idempotency():
    assert read()["plan"]["version"] == 0
    with session_factory()() as db:
        assert not list(db.scalars(select(InventoryPlan)))
    a, b = demand(lower=0, upper=0), demand(name="待设目标", lower=None, upper=None)
    key = headers()
    first = save([a, b], version=0, key=key)
    assert first.status_code == 200, first.text
    assert save([a, b], version=0, key=key).json()["data"] == first.json()["data"]
    assert save([b], version=0, key=key).status_code == 409
    assert save([a], version=0).status_code == 409
    assert save([{**b, "name": "新名称", "enabled": False}, a]).status_code == 200
    result = read()
    assert [r["id"] for r in result["plan"]["rows"]] == [b["id"], a["id"]]
    assert result["counts"][0]["conclusion"] == "disabled"
    assert save([a]).status_code == 200
    with session_factory()() as db:
        assert db.get(InventoryDemand, UUID(b["id"])).deleted_at
    assert save([a, b]).status_code == 422  # Deleted IDs are not silently reused.
    assert save([{**a, "lower": 5, "upper": 4}]).status_code == 422
    assert save([a], season="autumn").status_code == 422


def test_snapshot_counts_overlap_lifecycle_and_exclusions(wardrobe):  # noqa: F811
    prepare(wardrobe)
    row = demand()
    save([row])
    save([demand(name="秋季通勤")], "autumn")
    count = read()["counts"][0]
    assert (count["confirmed"], count["pending"], count["shared"], count["difference"]) == (
        2,
        0,
        2,
        1,
    )
    with session_factory().begin() as db:
        g = db.get(Garment, wardrobe[0])
        g.attributes = {**g.attributes, "availability": "unavailable"}
        g.lifecycle = {
            **g.lifecycle,
            "storage": "stored",
            "unavailable_reason": "washing",
            "decision": "pending",
        }
        db.get(Garment, wardrobe[1]).lifecycle = {}
    count = read()["counts"][0]
    assert (count["confirmed"], count["pending"], count["unavailable"], count["available"]) == (
        1,
        1,
        1,
        0,
    )
    assert save([{**row, "lower": 2, "upper": 4}]).status_code == 200
    assert read()["counts"][0]["conclusion"] == "review"
    with session_factory().begin() as db:
        db.get(Garment, wardrobe[1]).lifecycle = {"condition": "needs_repair", "fit": "fits"}
    count = read()["counts"][0]
    assert count["needs_attention"] == 1 and count["pending"] == 0
    with session_factory().begin() as db:
        db.get(Garment, wardrobe[0]).ownership = "retired"
        db.get(Garment, wardrobe[1]).is_demo = True
        db.get(Garment, wardrobe[2]).deleted_at = utcnow()
    result = read()
    assert result["total_owned"] == 3 and result["counts"][0]["confirmed"] == 0
    assert len(result["counts"][0]["members"]) == 2


def test_deleted_tag_invalidates_rule_without_broadening(wardrobe):  # noqa: F811
    prepare(wardrobe)
    tag = client.post("/api/v1/tags", json={"name": "通勤专用"}).json()["data"]
    row = demand(tag_ids=[tag["id"]])
    assert save([row]).status_code == 200
    assert (
        client.delete(
            f"/api/v1/tags/{tag['id']}", headers={"If-Match": str(tag["version"])}
        ).status_code
        == 204
    )
    count = read()["counts"][0]
    assert count["conclusion"] == "invalid" and count["difference"] is None
    assert save([{**row, "name": "改名仍保留失效规则"}]).status_code == 200
    assert read()["counts"][0]["conclusion"] == "invalid"
    assert save([{**row, "tag_ids": []}]).status_code == 200
    assert read()["counts"][0]["confirmed"] == 2


def test_parallel_first_save_only_one_version_wins():
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: save([demand()], version=0), range(2)))
    assert sorted(r.status_code for r in responses) == [200, 409]


def test_repeatable_read_and_full_500_garment_snapshot(wardrobe, monkeypatch):  # noqa: F811
    prepare(wardrobe)
    with session_factory().begin() as db:
        first = db.get(Garment, wardrobe[0])
        for g in db.scalars(select(Garment)):
            g.attributes = {**g.attributes, "category": "top"}
        for i in range(494):
            db.add(
                Garment(
                    owner_id=first.owner_id,
                    image_asset_id=first.image_asset_id,
                    attributes=Attributes(
                        category="top", name=f"衣服{i}", seasons=["summer", "autumn"]
                    ).model_dump(mode="json"),
                    lifecycle={"condition": "good", "fit": "fits"},
                )
            )
    save([demand(), demand(name="另一个用途")])
    before = perf_counter()
    statements = []

    def observe(*args):
        statements.append(args[2])

    event.listen(get_engine(), "before_cursor_execute", observe)
    try:
        result = read()
    finally:
        event.remove(get_engine(), "before_cursor_execute", observe)
    assert perf_counter() - before < 5
    assert len(statements) <= 10, statements
    assert result["total_owned"] == 500
    assert result["counts"][0]["confirmed"] == result["counts"][0]["shared"] == 500
    assert len(result["counts"][0]["members"]) == 500
    original = inventory.configurations

    def concurrent_change(db):
        plans = original(db)
        with session_factory().begin() as writer:
            writer.get(Garment, wardrobe[0]).ownership = "retired"
        return plans

    monkeypatch.setattr(inventory, "configurations", concurrent_change)
    assert read()["total_owned"] == 500  # Entire read sees the same earlier snapshot.
    monkeypatch.setattr(inventory, "configurations", original)
    assert read()["total_owned"] == 499
