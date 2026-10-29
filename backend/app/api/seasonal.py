from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request

from app.core.errors import request_id
from app.schemas.common import Envelope
from app.schemas.seasonal import (
    BatchInput,
    BatchResult,
    CompleteInput,
    ProgressInput,
    SeasonalCreate,
    SeasonalPage,
    SeasonalView,
)
from app.services import seasonal, seasonal_actions

router = APIRouter(prefix="/seasonal-sessions", tags=["seasonal"])
OperationKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]


@router.get("", response_model=Envelope[SeasonalPage])
def listing(
    request: Request, cursor: UUID | None = None, limit: Annotated[int, Query(ge=1, le=100)] = 20
) -> Envelope[SeasonalPage]:
    return Envelope(data=seasonal.listing(cursor, limit), request_id=request_id(request))


@router.post("", response_model=Envelope[SeasonalView])
def create(request: Request, payload: SeasonalCreate, key: OperationKey) -> Envelope[SeasonalView]:
    return Envelope(data=seasonal.create(payload, key), request_id=request_id(request))


@router.get("/{sid}", response_model=Envelope[SeasonalView])
def read(request: Request, sid: UUID) -> Envelope[SeasonalView]:
    return Envelope(data=seasonal.read(sid), request_id=request_id(request))


@router.post("/{sid}/progress", response_model=Envelope[SeasonalView])
def progress(
    request: Request, sid: UUID, payload: ProgressInput, key: OperationKey
) -> Envelope[SeasonalView]:
    return Envelope(data=seasonal.progress(sid, payload, key), request_id=request_id(request))


@router.post("/{sid}/actions", response_model=Envelope[BatchResult])
def actions(
    request: Request, sid: UUID, payload: BatchInput, key: OperationKey
) -> Envelope[BatchResult]:
    return Envelope(
        data=seasonal_actions.execute(sid, payload, key), request_id=request_id(request)
    )


@router.post("/{sid}/complete", response_model=Envelope[SeasonalView])
def complete(
    request: Request, sid: UUID, payload: CompleteInput, key: OperationKey
) -> Envelope[SeasonalView]:
    return Envelope(data=seasonal.complete(sid, payload, key), request_id=request_id(request))
