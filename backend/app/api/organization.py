from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request

from app.core.errors import request_id
from app.schemas.common import Envelope
from app.schemas.organization import (
    DecisionInput,
    ExitImpact,
    LinkInput,
    OrganizationView,
    ProcessInput,
    SupplyInput,
    SupplyPage,
    SupplyView,
    VersionInput,
)
from app.schemas.wardrobe import GarmentView
from app.services import organization, organization_decisions, organization_process, supply

router = APIRouter()
OperationKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]


@router.get("/supply-plans", response_model=Envelope[SupplyPage])
def listing(
    request: Request, cursor: UUID | None = None, limit: Annotated[int, Query(ge=1, le=100)] = 20
) -> Envelope[SupplyPage]:
    return Envelope(data=supply.listing(cursor, limit), request_id=request_id(request))


@router.get("/supply-plans/{plan_id}", response_model=Envelope[SupplyView])
def read(request: Request, plan_id: UUID) -> Envelope[SupplyView]:
    return Envelope(data=supply.read(plan_id), request_id=request_id(request))


@router.post("/supply-plans/{plan_id}", response_model=Envelope[SupplyView])
def save(
    request: Request, plan_id: UUID, payload: SupplyInput, key: OperationKey
) -> Envelope[SupplyView]:
    return Envelope(data=supply.save(plan_id, payload, key), request_id=request_id(request))


@router.post("/supply-plans/{plan_id}/link", response_model=Envelope[SupplyView])
def link(
    request: Request, plan_id: UUID, payload: LinkInput, key: OperationKey
) -> Envelope[SupplyView]:
    return Envelope(data=supply.link(plan_id, payload, key), request_id=request_id(request))


@router.post("/supply-plans/{plan_id}/cancel-remaining", response_model=Envelope[SupplyView])
def cancel(
    request: Request, plan_id: UUID, payload: VersionInput, key: OperationKey
) -> Envelope[SupplyView]:
    return Envelope(
        data=supply.cancel_remaining(plan_id, payload, key), request_id=request_id(request)
    )


@router.get("/organization", response_model=Envelope[OrganizationView])
def board(
    request: Request,
    state: Literal["active", "all", "observe", "pending", "keep", "repair", "done"] = "active",
    cursor: Annotated[str | None, Query(max_length=240)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> Envelope[OrganizationView]:
    return Envelope(data=organization.read(state, cursor, limit), request_id=request_id(request))


@router.post("/organization/{garment_id}/decision", response_model=Envelope[GarmentView])
def decide(
    request: Request, garment_id: UUID, payload: DecisionInput, key: OperationKey
) -> Envelope[GarmentView]:
    return Envelope(
        data=organization_decisions.decide(garment_id, payload, key), request_id=request_id(request)
    )


@router.get("/organization/{garment_id}/exit-impact", response_model=Envelope[ExitImpact])
def preview(request: Request, garment_id: UUID) -> Envelope[ExitImpact]:
    return Envelope(
        data=organization_process.read_impact(garment_id), request_id=request_id(request)
    )


@router.post("/organization/{garment_id}/process", response_model=Envelope[GarmentView])
def process(
    request: Request, garment_id: UUID, payload: ProcessInput, key: OperationKey
) -> Envelope[GarmentView]:
    return Envelope(
        data=organization_process.process(garment_id, payload, key), request_id=request_id(request)
    )


@router.get("/organization/{garment_id}", response_model=Envelope[OrganizationView])
def garment_decisions(request: Request, garment_id: UUID) -> Envelope[OrganizationView]:
    return Envelope(
        data=organization.read("all", None, 1000, garment_id), request_id=request_id(request)
    )
