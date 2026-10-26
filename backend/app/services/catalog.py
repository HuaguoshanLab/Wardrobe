from uuid import UUID

from sqlalchemy import or_, select

from app.core.errors import AppError
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.schemas.wardrobe import GarmentList
from app.services.wardrobe import garment_view


def list_garments(
    limit: int,
    cursor: UUID | None,
    q: str,
    category: str | None,
    season: str | None,
    occasion: str | None,
    availability: str | None,
    tag_id: UUID | None,
) -> GarmentList:
    with session_factory()() as db:
        query = select(Garment).where(Garment.deleted_at.is_(None))
        for key, value in [("category", category), ("availability", availability)]:
            if value:
                query = query.where(Garment.attributes[key].astext == value)
        for key, value in [
            ("seasons", season),
            ("occasion_codes", occasion),
            ("custom_tag_ids", str(tag_id) if tag_id else None),
        ]:
            if value:
                query = query.where(Garment.attributes[key].contains([value]))
        if q:
            query = query.where(Garment.attributes["name"].astext.ilike(f"%{q[:100]}%"))
        if cursor:
            previous = db.get(Garment, cursor)
            if previous is None:
                raise AppError("INVALID_CURSOR", "分页游标无效", 422)
            query = query.where(
                or_(
                    Garment.created_at < previous.created_at,
                    (Garment.created_at == previous.created_at) & (Garment.id < previous.id),
                )
            )
        rows = list(
            db.scalars(
                query.order_by(Garment.created_at.desc(), Garment.id.desc()).limit(limit + 1)
            )
        )
        return GarmentList(
            items=[garment_view(db, item) for item in rows[:limit]],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
        )
