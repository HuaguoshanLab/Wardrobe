"""Actual wear only, same garment/day deduplicated just like W1 history.

One joined query reads every record in the window, independent of API pagination.
Snapshots retain deleted garments; candidate eligibility is checked separately.
"""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.collections import WearRecord
from app.db.outfits import OutfitRevision
from app.domain.rotation import BODY_SLOTS
from app.schemas.rotation import RotationSnapshot, WornCombination


def rotation_snapshot(db: Session, today: date) -> RotationSnapshot:
    result = RotationSnapshot(
        as_of=today, start_7=today - timedelta(days=6), start_30=today - timedelta(days=29)
    )
    garment_dates: dict[str, set[date]] = {}
    days_7: set[date] = set()
    days_30: set[date] = set()
    combinations: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()
    query = (
        select(WearRecord.worn_on, OutfitRevision.items)
        .join(OutfitRevision, WearRecord.revision_id == OutfitRevision.id)
        .where(WearRecord.worn_on.between(result.start_30, today))
        .execution_options(yield_per=500)
    )
    for worn_on, items in db.execute(query):
        result.records_30 += 1
        days_30.add(worn_on)
        real = [i for i in items if i.get("source") == "wardrobe" and i.get("garment_id")]
        ids = {str(i["garment_id"]) for i in real}
        for gid in ids:
            garment_dates.setdefault(gid, set()).add(worn_on)
        if worn_on >= result.start_7:
            result.records_7 += 1
            days_7.add(worn_on)
            body = {str(i["garment_id"]) for i in real if i.get("slot") in BODY_SLOTS}
            if ids:
                combinations.add((tuple(sorted(ids)), tuple(sorted(body))))
    result.days_7, result.days_30 = len(days_7), len(days_30)
    result.garment_days = {gid: len(days) for gid, days in sorted(garment_dates.items())}
    result.combinations = [
        WornCombination(garment_ids=list(ids), body_ids=list(body))
        for ids, body in sorted(combinations)
    ]
    return result
