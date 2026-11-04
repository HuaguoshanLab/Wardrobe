from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query, Request

from app.core.errors import request_id
from app.schemas.common import Envelope
from app.schemas.locations import LocationList
from app.services.locations import list_locations

router = APIRouter(prefix="/wardrobe/locations", tags=["wardrobe-locations"])


@router.get("", response_model=Envelope[LocationList])
def listing(
    request: Request,
    location_q: Annotated[str, Query(max_length=120)] = "",
    cursor: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[str, Query(max_length=100)] = "",
    category: str | None = None,
    season: str | None = None,
    occasion: str | None = None,
    availability: str | None = None,
    tag_id: UUID | None = None,
    ownership: Literal["owned", "retired", "all"] = "owned",
) -> Envelope[LocationList]:
    return Envelope(
        data=list_locations(
            location_q,
            cursor,
            limit,
            q,
            category,
            season,
            occasion,
            availability,
            tag_id,
            ownership,
        ),
        request_id=request_id(request),
    )
