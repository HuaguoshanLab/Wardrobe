from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select
from test_outfits import client
from test_outfits import wardrobe as wardrobe
from test_rotation import record, today

from app.db.collections import WearRecord
from app.db.models import utcnow
from app.db.outfits import ModelCall, OutfitRevision
from app.db.session import get_engine, session_factory
from app.db.wardrobe import Garment
from app.services.usage import usage_report

pytestmark = pytest.mark.integration


def report(period="30", view="worn", **kwargs):
    return usage_report(period, view, kwargs.get("offset", 0), kwargs.get("limit", 20))


def test_exact_windows_dedup_current_inventory_and_recent_date(wardrobe):
    a, b, c, d, e, f = wardrobe
    for _ in range(105):
        record([a, b])
    for day in [29, 30, 89, 90]:
        record([a], day)
    record([f], 95)
    record([c, d, e], 3)
    with session_factory().begin() as db:
        db.get(Garment, c).ownership = "retired"
        db.get(Garment, d).deleted_at = utcnow()
        db.get(Garment, e).is_demo = True
        g = db.get(Garment, b)
        g.attributes = {**g.attributes, "availability": "unavailable"}
    result = report()
    assert result.total_garments == 3 and result.recorded_garments == 2
    assert result.unrecorded_garments == 1 and result.recorded_ratio == 0.6667
    assert [(i.garment_id, i.wear_days) for i in result.items] == [(a, 2), (b, 1)]
    assert result.window_start == today() - timedelta(days=29)
    assert report("90").items[0].wear_days == 4
    all_time = report("all")
    assert all_time.recorded_garments == 3 and all_time.items[0].wear_days == 5
    assert all_time.window_start == today() - timedelta(days=95)
    unseen = report(view="unrecorded").items[0]
    assert unseen.garment_id == f and unseen.last_worn_on == today() - timedelta(days=95)
    assert unseen.created_at is not None
    assert client.get(f"/api/v1/garments/{a}/lifecycle").json()["data"]["wear_days"] == 5
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0


def test_record_edit_delete_duplicate_items_and_mixed_sources(wardrobe):
    a = wardrobe[0]
    first, second = record([a]), record([a])
    with session_factory().begin() as db:
        rev = db.get(OutfitRevision, db.get(WearRecord, second).revision_id)
        rev.items = (
            rev.items + rev.items + [{"source": "suggestion", "garment_id": str(wardrobe[1])}]
        )
    assert report().items[0].wear_days == 1
    with session_factory().begin() as db:
        db.get(WearRecord, first).worn_on = today() - timedelta(days=31)
    assert report().items[0].wear_days == 1
    with session_factory().begin() as db:
        db.delete(db.get(WearRecord, second))
    assert report().recorded_garments == 0
    assert report("all").items[0].wear_days == 1


def test_empty_inventory_and_zero_records(clean_db):
    result = report()
    assert result.total_garments == 0 and result.recorded_ratio is None
    assert result.items == [] and result.next_offset is None
    assert report("all").window_start is None
    for query in ["range=7", "view=invalid", "offset=-1", "limit=101"]:
        assert client.get("/api/v1/wardrobe/usage?" + query).status_code == 422


def test_pagination_500_items_and_bounded_sql(wardrobe):
    import time

    with session_factory().begin() as db:
        source = db.get(Garment, wardrobe[0])
        for n in range(494):
            db.add(
                Garment(
                    id=uuid4(),
                    owner_id=source.owner_id,
                    image_asset_id=source.image_asset_id,
                    attributes={**source.attributes, "name": f"item-{n}"},
                )
            )
    for day in range(125):
        record(wardrobe[:3], day)
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(get_engine(), "before_cursor_execute", capture)
    try:
        started = time.perf_counter()
        first = report(view="unrecorded")
        elapsed = time.perf_counter() - started
    finally:
        event.remove(get_engine(), "before_cursor_execute", capture)
    assert len(statements) == 2
    assert first.total_garments == 500 and first.total_items == 497
    assert first.next_offset == 20 and len(first.items) == 20
    found = [i.garment_id for i in first.items]
    offset = first.next_offset
    while offset is not None:
        page = report(view="unrecorded", offset=offset)
        found.extend(i.garment_id for i in page.items)
        offset = page.next_offset
    assert len(found) == len(set(found)) == 497
    assert report(view="unrecorded", offset=500).items == []
    print(
        f"P7.4 benchmark: garments=500 wear_records=125 SQL={len(statements)} "
        f"first_page_ms={elapsed * 1000:.2f}"
    )


def test_generated_and_manual_sources_count_one_day(wardrobe):
    from test_outfits import generate, session

    saved, _ = generate(session())
    rev = saved["revisions"][0]
    from uuid import UUID

    ids = [UUID(i["garment_id"]) for i in rev["items"] if i["source"] == "wardrobe"]
    record(ids)
    with session_factory().begin() as db:
        db.add(WearRecord(revision_id=UUID(rev["id"]), worn_on=today()))
    result = report()
    assert result.recorded_garments == len(ids)
    assert all(item.wear_days == 1 for item in result.items)
