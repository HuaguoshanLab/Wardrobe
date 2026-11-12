from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request

from app.core.errors import request_id
from app.schemas.common import Envelope
from app.schemas.jobs import JobAccepted
from app.schemas.travel import (
    TravelGenerate,
    TravelInput,
    TravelPack,
    TravelRevisionView,
    TravelUpdate,
    TravelVersion,
    TravelView,
    TravelWear,
    TravelWearResult,
)
from app.services.travel import plans, submit, wear

router = APIRouter(prefix="/travel-plans", tags=["travel"])
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]


@router.get("")
def listing(request: Request, offset: int = Query(default=0, ge=0)) -> Envelope[list[TravelView]]:
    return Envelope(data=plans.listing(offset), request_id=request_id(request))


@router.post("", status_code=201)
def create(request: Request, payload: TravelInput, key: Key) -> Envelope[TravelView]:
    return Envelope(data=plans.create(payload, key), request_id=request_id(request))


@router.get("/{plan_id}")
def get(request: Request, plan_id: UUID) -> Envelope[TravelView]:
    return Envelope(data=plans.get(plan_id), request_id=request_id(request))


@router.get("/{plan_id}/revisions")
def revisions(
    request: Request, plan_id: UUID, offset: int = Query(default=0, ge=0)
) -> Envelope[list[TravelRevisionView]]:
    return Envelope(data=plans.revisions(plan_id, offset), request_id=request_id(request))


@router.patch("/{plan_id}")
def update(
    request: Request, plan_id: UUID, payload: TravelUpdate, key: Key
) -> Envelope[TravelView]:
    return Envelope(
        data=plans.mutate(plan_id, payload, key, "update"), request_id=request_id(request)
    )


@router.delete("/{plan_id}")
def delete(
    request: Request, plan_id: UUID, payload: TravelVersion, key: Key
) -> Envelope[TravelView]:
    return Envelope(
        data=plans.mutate(plan_id, payload, key, "delete"), request_id=request_id(request)
    )


@router.post("/{plan_id}/generate", status_code=202)
def generate(
    request: Request, plan_id: UUID, payload: TravelGenerate, key: Key
) -> Envelope[JobAccepted]:
    return Envelope(data=submit.submit(plan_id, payload, key), request_id=request_id(request))


@router.post("/{plan_id}/packing")
def packing(request: Request, plan_id: UUID, payload: TravelPack, key: Key) -> Envelope[TravelView]:
    return Envelope(
        data=plans.mutate(plan_id, payload, key, "pack"), request_id=request_id(request)
    )


@router.post("/{plan_id}/wear")
def worn(
    request: Request, plan_id: UUID, payload: TravelWear, key: Key
) -> Envelope[TravelWearResult]:
    return Envelope(data=wear.record(plan_id, payload, key), request_id=request_id(request))
