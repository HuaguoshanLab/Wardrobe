from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Request

from app.core.errors import request_id
from app.domain.inventory import estimate
from app.schemas.common import Envelope
from app.schemas.inventory import (
    EstimateInput,
    EstimateView,
    InventoryView,
    PlanInput,
    PlanView,
    Season,
)
from app.schemas.lifecycle import SubtypeImpact, SubtypePatch, SubtypeView
from app.services import inventory, inventory_config, subtypes

router = APIRouter()
OperationKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]


@router.get("/inventory/configs", response_model=Envelope[list[PlanView]])
def configs(request: Request) -> Envelope[list[PlanView]]:
    return Envelope(data=inventory_config.read_configs(), request_id=request_id(request))


@router.post("/inventory/estimate", response_model=Envelope[EstimateView])
def preview(request: Request, payload: EstimateInput) -> Envelope[EstimateView]:
    return Envelope(data=estimate(payload), request_id=request_id(request))


@router.get("/inventory/{season}", response_model=Envelope[InventoryView])
def read(request: Request, season: Season) -> Envelope[InventoryView]:
    return Envelope(data=inventory.snapshot(season), request_id=request_id(request))


@router.post("/inventory/{season}", response_model=Envelope[PlanView])
def save(
    request: Request, season: Season, payload: PlanInput, key: OperationKey
) -> Envelope[PlanView]:
    return Envelope(
        data=inventory_config.save(season, payload, key), request_id=request_id(request)
    )


@router.get("/garment-subtypes/suggestions", response_model=Envelope[dict[str, list[str]]])
def suggestions(request: Request) -> Envelope[dict[str, list[str]]]:
    return Envelope(data=subtypes.SUGGESTIONS, request_id=request_id(request))


@router.get("/garment-subtypes/{subtype_id}/impact", response_model=Envelope[SubtypeImpact])
def subtype_impact(request: Request, subtype_id: UUID) -> Envelope[SubtypeImpact]:
    return Envelope(data=subtypes.read_impact(subtype_id), request_id=request_id(request))


@router.patch("/garment-subtypes/{subtype_id}", response_model=Envelope[SubtypeView])
def subtype_patch(
    request: Request, subtype_id: UUID, payload: SubtypePatch, key: OperationKey
) -> Envelope[SubtypeView]:
    return Envelope(data=subtypes.patch(subtype_id, payload, key), request_id=request_id(request))
