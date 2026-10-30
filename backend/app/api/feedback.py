from uuid import UUID

from fastapi import APIRouter, Request

from app.api.collections import Key, Version
from app.core.errors import request_id
from app.schemas.collections import WearView
from app.schemas.common import Envelope
from app.schemas.feedback import FeedbackPatch, FeedbackView
from app.services import feedback

router = APIRouter()


@router.get("/wear-records/{record_id}")
def get_record(request: Request, record_id: UUID) -> Envelope[WearView]:
    return Envelope(data=feedback.get_record(record_id), request_id=request_id(request))


@router.get("/wear-records/{record_id}/feedback")
def get_feedback(request: Request, record_id: UUID) -> Envelope[FeedbackView]:
    return Envelope(data=feedback.get(record_id), request_id=request_id(request))


@router.patch("/wear-records/{record_id}/feedback")
def save_feedback(
    request: Request, record_id: UUID, payload: FeedbackPatch, key: Key
) -> Envelope[FeedbackView]:
    return Envelope(
        data=feedback.save(record_id, payload, payload.expected_version, key),
        request_id=request_id(request),
    )


@router.delete("/wear-records/{record_id}/feedback")
def delete_feedback(
    request: Request, record_id: UUID, version: Version, key: Key
) -> Envelope[FeedbackView]:
    return Envelope(
        data=feedback.save(record_id, None, version, key), request_id=request_id(request)
    )
