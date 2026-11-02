from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request

from app.core.errors import request_id
from app.schemas.care import CareBatch, CareResult
from app.schemas.common import Envelope
from app.schemas.wardrobe import GarmentList
from app.services import care

OperationKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]

router = APIRouter(prefix="/wardrobe/care", tags=["care"])


@router.get("", response_model=Envelope[GarmentList])
def listing(
    request: Request,
    group: Literal["washing", "available", "all"] = "washing",
    q: Annotated[str, Query(max_length=100)] = "",
    category: str | None = None,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> Envelope[GarmentList]:
    return Envelope(
        data=care.listing(group, q, category, cursor, limit), request_id=request_id(request)
    )


@router.post("/actions", response_model=Envelope[CareResult])
def execute(request: Request, payload: CareBatch, key: OperationKey) -> Envelope[CareResult]:
    return Envelope(data=care.execute(payload, key), request_id=request_id(request))
