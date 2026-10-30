"""Shared actual-wear aggregation: one garment/day, from immutable revisions only."""

from datetime import date
from uuid import UUID

from sqlalchemy import ColumnElement, column, func, select, true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql.selectable import Subquery

from app.db.collections import WearRecord
from app.db.outfits import OutfitRevision


def wear_rollup(
    start: date | None = None, end: date | None = None, garment_id: UUID | None = None
) -> Subquery:
    item = (
        func.jsonb_array_elements(OutfitRevision.items)
        .table_valued(column("value", JSONB))
        .lateral("wear_item")
    )
    gid = item.c.value["garment_id"].astext
    count: ColumnElement[int] = func.count(func.distinct(WearRecord.worn_on))
    if start is not None:
        count = count.filter(WearRecord.worn_on >= start)
    query = (
        select(
            gid.label("garment_id"),
            count.label("wear_days"),
            func.min(WearRecord.worn_on).label("first_worn_on"),
            func.max(WearRecord.worn_on).label("last_worn_on"),
        )
        .select_from(WearRecord)
        .join(OutfitRevision, WearRecord.revision_id == OutfitRevision.id)
        .join(item, true())
        .where(item.c.value["source"].astext == "wardrobe", gid.is_not(None))
        .group_by(gid)
    )
    if end is not None:
        query = query.where(WearRecord.worn_on <= end)
    if garment_id is not None:
        query = query.where(gid == str(garment_id))
    return query.subquery("wear_stats")
