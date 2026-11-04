"""Read-only location aggregation; never rewrites legacy location text."""

from uuid import UUID

from sqlalchemy import ColumnElement, func, select

from app.core.errors import AppError
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.schemas.locations import LocationCount, LocationList, LocationMode
from app.services.catalog_filters import catalog_filters

# Same boundary whitespace as Python str.strip(), including legacy Unicode spaces.
WHITESPACE = (
    " \t\n\r\v\f\x1c\x1d\x1e\x1f\x85\xa0\u1680"
    + "".join(chr(n) for n in range(0x2000, 0x200B))
    + "\u2028\u2029\u202f\u205f\u3000"
)


def location_value() -> ColumnElement[str]:
    return func.nullif(
        func.btrim(func.coalesce(Garment.lifecycle["location"].astext, ""), WHITESPACE), ""
    )


def location_filter(mode: LocationMode | None, location: str | None) -> list[ColumnElement[bool]]:
    value = location.strip() if location is not None else None
    if (mode == "named" and not value) or (mode != "named" and location is not None):
        raise AppError("INVALID_LOCATION_FILTER", "指定位置需提供名称；其他位置范围不接受名称", 422)
    if mode is None:
        return []
    conditions: list[ColumnElement[bool]] = [Garment.is_demo.is_(False)]
    if mode == "named":
        conditions.append(location_value() == value)
    elif mode == "unassigned":
        conditions.append(location_value().is_(None))
    return conditions


def list_locations(
    location_q: str,
    cursor: str | None,
    limit: int,
    q: str = "",
    category: str | None = None,
    season: str | None = None,
    occasion: str | None = None,
    availability: str | None = None,
    tag_id: UUID | None = None,
    ownership: str = "owned",
) -> LocationList:
    inventory = (
        select(location_value().collate("C").label("location"))
        .where(
            *catalog_filters(
                q, category, season, occasion, availability, tag_id, ownership, exclude_demo=True
            )
        )
        .cte("location_inventory")
    )
    grouped = (
        select(inventory.c.location, func.count().label("count"))
        .where(inventory.c.location.is_not(None))
        .group_by(inventory.c.location)
        .cte("location_counts")
    )
    matching = grouped.c.location.icontains(location_q.strip(), autoescape=True)
    with session_factory()() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        total, unassigned = db.execute(
            select(func.count(), func.count().filter(inventory.c.location.is_(None))).select_from(
                inventory
            )
        ).one()
        count = db.scalar(select(func.count()).select_from(grouped).where(matching)) or 0
        query = select(grouped).where(matching)
        if cursor is not None:
            query = query.where(grouped.c.location > cursor)
        rows = list(db.execute(query.order_by(grouped.c.location).limit(limit + 1)).mappings())
        return LocationList(
            items=[LocationCount(location=r["location"], count=r["count"]) for r in rows[:limit]],
            next_cursor=rows[limit - 1]["location"] if len(rows) > limit else None,
            total_garments=total,
            unassigned_count=unassigned,
            matching_locations=count,
        )
