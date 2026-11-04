from datetime import date
from time import perf_counter
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select
from test_outfits import client, headers, wardrobe  # noqa: F401

from app.core.config import get_settings
from app.core.maintenance import exclusive
from app.db.lifecycle import LifecycleEvent
from app.db.models import Job, utcnow
from app.db.outfits import ModelCall
from app.db.session import get_engine, session_factory
from app.db.wardrobe import Garment

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]
ROOT = "/api/v1/wardrobe/locations"


def locations(**params):
    response = client.get(ROOT, params=params)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def garments(**params):
    response = client.get("/api/v1/garments", params=params)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def place(ids, values):
    with session_factory().begin() as db:
        for gid, value in zip(ids, values, strict=True):
            g = db.get(Garment, gid)
            g.lifecycle = {**g.lifecycle, "location": value}


def test_normalized_counts_exact_filter_and_legacy_text_unchanged(wardrobe):  # noqa: F811
    values = [None, "", "\t\u3000\xa0", " 衣柜 A\n", "衣柜 A", "衣柜A"]
    place(wardrobe, values)
    result = locations()
    assert result == dict(
        items=[dict(location="衣柜 A", count=2), dict(location="衣柜A", count=1)],
        total_garments=6,
        unassigned_count=3,
        matching_locations=2,
        next_cursor=None,
    )
    assert len(garments(location_mode="unassigned")["items"]) == 3
    matched = garments(location_mode="named", location="\u3000衣柜 A  ")["items"]
    assert {g["id"] for g in matched} == {str(wardrobe[3]), str(wardrobe[4])}
    with session_factory()() as db:
        assert [db.get(Garment, gid).lifecycle["location"] for gid in wardrobe] == values
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0
        assert db.scalar(select(func.count()).select_from(Job)) == 0
        assert db.scalar(select(func.count()).select_from(LifecycleEvent)) == 0


def test_scope_matches_archive_demo_deleted_washing_and_combined_filters(wardrobe):  # noqa: F811
    place(wardrobe, ["抽屉"] * 6)
    with session_factory().begin() as db:
        for i, gid in enumerate(wardrobe):
            g = db.get(Garment, gid)
            g.attributes = {**g.attributes, "seasons": ["summer"], "occasion_codes": ["daily"]}
            if i == 0:
                g.attributes = {**g.attributes, "availability": "unavailable"}
                g.lifecycle = {**g.lifecycle, "storage": "stored", "unavailable_reason": "washing"}
            if i == 1:
                g.is_demo = True
            if i == 2:
                g.ownership = "retired"
            if i == 3:
                g.deleted_at = utcnow()
    assert locations()["total_garments"] == 3
    assert len(garments()["items"]) == 4  # Ordinary wardrobe retains its onboarding demo.
    for scope, count in [("owned", 3), ("retired", 1), ("all", 4)]:
        assert locations(ownership=scope)["total_garments"] == count
        assert len(garments(ownership=scope, location_mode="all")["items"]) == count
    filters = dict(
        category="top", season="summer", availability="unavailable", occasion="daily", q="top"
    )
    assert locations(**filters)["items"] == [dict(location="抽屉", count=1)]
    row = garments(**filters, location_mode="named", location="抽屉")["items"]
    assert [g["id"] for g in row] == [str(wardrobe[0])]
    assert locations(**{**filters, "season": "winter"})["total_garments"] == 0
    tag = client.post("/api/v1/tags", json={"name": "指定"}).json()["data"]["id"]
    client.patch(
        f"/api/v1/garments/{wardrobe[0]}",
        json={"expected_version": 1, "changes": {"custom_tag_ids": [tag]}},
    )
    assert locations(tag_id=tag)["total_garments"] == 1
    assert len(garments(tag_id=tag, location_mode="named", location="抽屉")["items"]) == 1


def test_literal_search_long_names_and_complete_location_and_garment_pagination(wardrobe):  # noqa: F811
    long = "长位置" * 40
    place(wardrobe, ["柜%_\\", "柜100", long, "a", "A", "新箱子"])
    assert locations(location_q="%_\\")["items"] == [dict(location="柜%_\\", count=1)]
    assert locations(location_q="a")["matching_locations"] == 2
    assert len(garments(location_mode="named", location=long)["items"]) == 1
    cursor, names = None, []
    while True:
        page = locations(limit=2, **({"cursor": cursor} if cursor is not None else {}))
        names += [r["location"] for r in page["items"]]
        assert page["total_garments"] == 6 and page["matching_locations"] == 6
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(set(names)) == 6 and names == sorted(names)
    place(wardrobe, ["同名"] * 6)
    cursor, ids = None, []
    while True:
        page = garments(
            location_mode="named",
            location="同名",
            limit=2,
            **({"cursor": cursor} if cursor else {}),
        )
        ids += [g["id"] for g in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(set(ids)) == 6 and locations()["items"] == [dict(location="同名", count=6)]


def test_single_and_batch_moves_recount_without_changing_other_state_or_old_events(wardrobe):  # noqa: F811
    from test_care import batch, item

    gid = wardrobe[0]
    place(wardrobe, ["旧柜"] * 6)
    with session_factory().begin() as db:
        g = db.get(Garment, gid)
        g.attributes = {**g.attributes, "availability": "unavailable"}
        g.lifecycle = {**g.lifecycle, "storage": "stored", "unavailable_reason": "washing"}
    response = client.post(
        f"/api/v1/garments/{gid}/lifecycle",
        headers=headers(),
        json={
            "expected_version": 1,
            "action": "profile",
            "occurred_on": date.today().isoformat(),
            "changes": {"location": "\u3000新柜\t"},
        },
    )
    assert response.status_code == 200, response.text
    first = response.json()["data"]
    assert first["lifecycle"]["location"] == "新柜"
    assert first["availability"] == "unavailable" and first["lifecycle"]["storage"] == "stored"
    with session_factory()() as db:
        old_event = db.scalar(select(LifecycleEvent).where(LifecycleEvent.garment_id == gid)).after
    moved = batch([item(wardrobe[1], "location_set", location="新柜")]).json()["data"]["items"][0]
    assert moved["success"]
    assert {r["location"]: r["count"] for r in locations()["items"]} == {"旧柜": 4, "新柜": 2}
    batch([item(gid, "location_clear", 2)])
    assert locations()["unassigned_count"] == 1
    with session_factory()() as db:
        assert (
            db.scalar(
                select(LifecycleEvent).where(
                    LifecycleEvent.garment_id == gid, LifecycleEvent.version == 2
                )
            ).after
            == old_event
        )
        assert db.get(Garment, gid).lifecycle["unavailable_reason"] == "washing"
    client.delete(f"/api/v1/garments/{wardrobe[1]}", headers={"If-Match": "2"})
    assert locations(location_q="新柜")["items"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"location_mode": "named"},
        {"location_mode": "named", "location": "\t "},
        {"location_mode": "unassigned", "location": "柜"},
        {"location": "柜"},
        {"location_mode": "unknown"},
        {"location_mode": "named", "location": "a" * 121},
    ],
)
def test_invalid_filter_is_explicitly_rejected(params):
    assert client.get("/api/v1/garments", params=params).status_code == 422


def test_location_read_respects_maintenance_and_request_limits(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "control_root", tmp_path / "control")
    with exclusive():
        assert client.get(ROOT).status_code == 503
    for params in [{"limit": 101}, {"limit": 0}, {"location_q": "a" * 121}, {"ownership": "bad"}]:
        assert client.get(ROOT, params=params).status_code == 422


def test_500_garments_aggregate_with_bounded_sql_and_one_snapshot(wardrobe):  # noqa: F811
    with session_factory().begin() as db:
        template = db.get(Garment, wardrobe[0])
        for n in range(494):
            db.add(
                Garment(
                    id=uuid4(),
                    owner_id=template.owner_id,
                    image_asset_id=template.image_asset_id,
                    attributes=template.attributes,
                    lifecycle={"location": f"位置{n % 35:02}"},
                )
            )
    queries = []
    started = perf_counter()

    def capture(conn, cursor, statement, params, context, many):
        queries.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        result = locations(limit=20)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert result["total_garments"] == 500 and result["unassigned_count"] == 6
    assert (
        result["matching_locations"] == 35 and len(result["items"]) == 20 and result["next_cursor"]
    )
    assert len(queries) == 3
    print(f"500 garments: {(perf_counter() - started) * 1000:.1f}ms, {len(queries)} SQL queries")


def test_backup_restore_preserves_location_totals(wardrobe, tmp_path, monkeypatch):  # noqa: F811
    from test_backups import confirm, export, validate
    from test_care import batch, item

    from app.backup import control, workflow

    monkeypatch.setattr(get_settings(), "control_root", tmp_path / "control")
    place(wardrobe, ["衣柜", "箱子", None, "箱子", "衣柜", " "])
    before = locations()
    _, path = export()
    view = validate(path)
    batch([item(wardrobe[0], "location_set", location="新柜")])
    assert locations() != before
    workflow.process(confirm(view))
    assert control.require(view.restore_id).status == "succeeded"
    assert locations() == before


def test_totals_and_page_share_a_snapshot_during_concurrent_move(wardrobe):  # noqa: F811
    engine = get_engine()
    changed = False

    def change_after_totals(conn, cursor, statement, params, context, many):
        nonlocal changed
        if changed or "location_inventory" not in statement:
            return
        changed = True
        place([wardrobe[0]], ["并发移动"])

    event.listen(engine, "after_cursor_execute", change_after_totals)
    try:
        result = locations()
    finally:
        event.remove(engine, "after_cursor_execute", change_after_totals)
    assert changed and result["unassigned_count"] == 6 and result["items"] == []
    assert locations()["unassigned_count"] == 5
    assert locations()["items"] == [dict(location="并发移动", count=1)]
