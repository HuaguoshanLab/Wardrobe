from datetime import date, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import String, cast, func, select

from app.db.models import utcnow
from app.db.session import session_factory
from app.db.wardrobe import Garment, MediaAsset
from app.schemas.usage import UsageItem, UsageRange, UsageReport, UsageView
from app.services.wear_stats import wear_rollup


def usage_report(
    period: UsageRange, view: UsageView, offset: int, limit: int, *, today: date | None = None
) -> UsageReport:
    today = today or utcnow().astimezone(ZoneInfo("Asia/Shanghai")).date()
    start = None if period == "all" else today - timedelta(days=int(period) - 1)
    stats = wear_rollup(start, today)
    inventory = (
        select(
            Garment.id.label("garment_id"),
            Garment.attributes,
            Garment.created_at,
            Garment.image_asset_id,
            func.coalesce(stats.c.wear_days, 0).label("wear_days"),
            stats.c.first_worn_on,
            stats.c.last_worn_on,
        )
        .outerjoin(stats, stats.c.garment_id == cast(Garment.id, String))
        .where(Garment.deleted_at.is_(None), Garment.ownership == "owned", ~Garment.is_demo)
        .cte("inventory_usage")
    )
    with session_factory()() as db:
        # Both totals and page use the same database snapshot, including concurrent edits.
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        total, recorded, first = db.execute(
            select(
                func.count(),
                func.count().filter(inventory.c.wear_days > 0),
                func.min(inventory.c.first_worn_on),
            ).select_from(inventory)
        ).one()
        count = recorded if view == "worn" else total - recorded
        order = (
            [inventory.c.wear_days.desc(), inventory.c.last_worn_on.desc()]
            if view == "worn"
            else [inventory.c.created_at.desc()]
        )
        rows = db.execute(
            select(inventory, MediaAsset.display_key, MediaAsset.cutout_key)
            .join(MediaAsset, MediaAsset.id == inventory.c.image_asset_id)
            .where(inventory.c.wear_days > 0 if view == "worn" else inventory.c.wear_days == 0)
            .order_by(*order, inventory.c.garment_id)
            .offset(offset)
            .limit(limit)
        ).mappings()
        items = []
        for row in rows:
            attrs = row["attributes"]
            variant = (
                "cutout"
                if attrs.get("display_variant") == "cutout" and row["cutout_key"]
                else "original"
            )
            items.append(
                UsageItem(
                    garment_id=row["garment_id"],
                    name=attrs.get("name"),
                    category=attrs.get("category"),
                    availability=attrs.get("availability", "available"),
                    image_url=f"/api/v1/media/{row['image_asset_id']}?variant={variant}"
                    if row["display_key"]
                    else None,
                    created_at=row["created_at"],
                    wear_days=row["wear_days"],
                    last_worn_on=row["last_worn_on"],
                )
            )
    return UsageReport(
        range=period,
        view=view,
        as_of=today,
        window_start=start or first,
        total_garments=total,
        recorded_garments=recorded,
        unrecorded_garments=total - recorded,
        recorded_ratio=round(recorded / total, 4) if total else None,
        items=items,
        total_items=count,
        offset=offset,
        limit=limit,
        next_offset=offset + limit if offset + limit < count else None,
    )
