"""Shared inventory scope for garment pages and location totals."""

from uuid import UUID

from sqlalchemy import ColumnElement

from app.db.wardrobe import Garment


def catalog_filters(
    q: str = "",
    category: str | None = None,
    season: str | None = None,
    occasion: str | None = None,
    availability: str | None = None,
    tag_id: UUID | None = None,
    ownership: str = "owned",
    *,
    exclude_demo: bool = False,
) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = [Garment.deleted_at.is_(None)]
    if exclude_demo:
        conditions.append(Garment.is_demo.is_(False))
    if ownership != "all":
        conditions.append(Garment.ownership == ownership)
    for key, value in [("category", category), ("availability", availability)]:
        if value:
            conditions.append(Garment.attributes[key].astext == value)
    for key, value in [
        ("seasons", season),
        ("occasion_codes", occasion),
        ("custom_tag_ids", str(tag_id) if tag_id else None),
    ]:
        if value:
            conditions.append(Garment.attributes[key].contains([value]))
    if q:
        conditions.append(Garment.attributes["name"].astext.ilike(f"%{q[:100]}%"))
    return conditions
