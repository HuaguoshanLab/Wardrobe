from uuid import UUID

from sqlalchemy import or_, select

from app.core.errors import AppError
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.schemas.locations import LocationMode
from app.schemas.wardrobe import GarmentList
from app.services.catalog_filters import catalog_filters
from app.services.locations import location_filter
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
    ownership: str = "owned",
    *,
    unavailable_reason: str | None = None,
    exclude_demo: bool = False,
    location_mode: LocationMode | None = None,
    location: str | None = None,
) -> GarmentList:
    with session_factory()() as db:
        query = select(Garment).where(
            *catalog_filters(
                q,
                category,
                season,
                occasion,
                availability,
                tag_id,
                ownership,
                exclude_demo=exclude_demo,
            ),
            *location_filter(location_mode, location),
        )
        if unavailable_reason:
            query = query.where(
                Garment.lifecycle["unavailable_reason"].astext == unavailable_reason
            )
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
