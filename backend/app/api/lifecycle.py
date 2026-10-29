from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request
from sqlalchemy import select

from app.core.errors import request_id
from app.db.lifecycle import GarmentSubtype
from app.db.session import session_factory
from app.schemas.common import Envelope
from app.schemas.lifecycle import LifecycleHistory, LifecycleInput, SubtypeInput, SubtypeView
from app.schemas.wardrobe import GarmentView
from app.services import lifecycle

router = APIRouter()
OperationKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]


@router.post("/garments/{garment_id}/lifecycle", response_model=Envelope[GarmentView])
def apply(
    request: Request, garment_id: UUID, payload: LifecycleInput, key: OperationKey
) -> Envelope[GarmentView]:
    return Envelope(data=lifecycle.apply(garment_id, payload, key), request_id=request_id(request))


@router.get("/garments/{garment_id}/lifecycle", response_model=Envelope[LifecycleHistory])
def history(
    request: Request,
    garment_id: UUID,
    cursor: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> Envelope[LifecycleHistory]:
    return Envelope(
        data=lifecycle.history(garment_id, cursor, limit), request_id=request_id(request)
    )


@router.get("/garment-subtypes", response_model=Envelope[list[SubtypeView]])
def subtypes(request: Request) -> Envelope[list[SubtypeView]]:
    with session_factory()() as db:
        values = db.scalars(
            select(GarmentSubtype).order_by(GarmentSubtype.category, GarmentSubtype.name)
        )
        return Envelope(
            data=[SubtypeView.model_validate(v) for v in values], request_id=request_id(request)
        )


@router.post("/garment-subtypes", response_model=Envelope[SubtypeView], status_code=201)
def create_subtype(
    request: Request, payload: SubtypeInput, key: OperationKey
) -> Envelope[SubtypeView]:
    return Envelope(data=lifecycle.create_subtype(payload, key), request_id=request_id(request))
