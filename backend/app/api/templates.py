from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Request

from app.core.errors import request_id
from app.schemas.common import Envelope
from app.schemas.templates import (
    TemplateCreate,
    TemplateDelete,
    TemplateDeleted,
    TemplateUpdate,
    TemplateView,
)
from app.services import templates

router = APIRouter(prefix="/condition-templates", tags=["condition-templates"])
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]


@router.get("")
def listing(request: Request) -> Envelope[list[TemplateView]]:
    return Envelope(data=templates.listing(), request_id=request_id(request))


@router.get("/{template_id}")
def get(request: Request, template_id: UUID) -> Envelope[TemplateView]:
    return Envelope(data=templates.get(template_id), request_id=request_id(request))


@router.post("", status_code=201)
def create(request: Request, payload: TemplateCreate, key: Key) -> Envelope[TemplateView]:
    return Envelope(data=templates.create(payload, key), request_id=request_id(request))


@router.patch("/{template_id}")
def update(
    request: Request, template_id: UUID, payload: TemplateUpdate, key: Key
) -> Envelope[TemplateView]:
    return Envelope(
        data=templates.update(template_id, payload, key), request_id=request_id(request)
    )


@router.delete("/{template_id}")
def delete(
    request: Request, template_id: UUID, payload: TemplateDelete, key: Key
) -> Envelope[TemplateDeleted]:
    return Envelope(
        data=templates.delete(template_id, payload, key), request_id=request_id(request)
    )
