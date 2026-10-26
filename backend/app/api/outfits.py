from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import FileResponse

from app.core.errors import AppError, request_id
from app.db.outfits import OutfitImage
from app.db.session import session_factory
from app.media.storage import path_for
from app.schemas.common import Envelope
from app.schemas.jobs import JobAccepted
from app.schemas.outfits import (
    AdjustInput,
    GenerateInput,
    MessageList,
    RevisionView,
    SessionCreate,
    SessionPatch,
    SessionView,
)
from app.services.outfits import sessions
from app.services.outfits.submit import submit

router = APIRouter()
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]


@router.post("/outfit-sessions", status_code=201)
def create(request: Request, payload: SessionCreate, key: Key) -> Envelope[SessionView]:
    return Envelope(data=sessions.create_session(payload, key), request_id=request_id(request))


@router.get("/outfit-sessions/current")
def current(request: Request) -> Envelope[SessionView | None]:
    return Envelope(data=sessions.read_session(), request_id=request_id(request))


@router.get("/outfit-sessions/{session_id}")
def get(request: Request, session_id: UUID) -> Envelope[SessionView | None]:
    return Envelope(data=sessions.read_session(session_id), request_id=request_id(request))


@router.patch("/outfit-sessions/{session_id}")
def patch(
    request: Request, session_id: UUID, payload: SessionPatch, key: Key
) -> Envelope[SessionView]:
    return Envelope(
        data=sessions.patch_session(session_id, payload, key), request_id=request_id(request)
    )


@router.get("/outfit-sessions/{session_id}/messages")
def messages(
    request: Request,
    session_id: UUID,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: UUID | None = None,
) -> Envelope[MessageList]:
    return Envelope(
        data=sessions.messages(session_id, limit, cursor), request_id=request_id(request)
    )


@router.post("/outfit-sessions/{session_id}/generate", status_code=202)
def generate(
    request: Request, session_id: UUID, payload: GenerateInput, key: Key
) -> Envelope[JobAccepted]:
    return Envelope(data=submit(session_id, payload, key), request_id=request_id(request))


@router.post("/outfit-sessions/{session_id}/adjust", status_code=202)
def adjust(
    request: Request, session_id: UUID, payload: AdjustInput, key: Key
) -> Envelope[JobAccepted]:
    return Envelope(data=submit(session_id, payload, key), request_id=request_id(request))


@router.get("/outfit-revisions/{revision_id}")
def revision(request: Request, revision_id: UUID) -> Envelope[RevisionView]:
    with session_factory()() as db:
        value = RevisionView.model_validate(sessions.get_revision(db, revision_id))
    return Envelope(data=value, request_id=request_id(request))


@router.get("/outfit-images/{image_id}")
def image(image_id: UUID) -> FileResponse:
    with session_factory()() as db:
        image = db.get(OutfitImage, image_id)
        if image is None:
            raise AppError("NOT_FOUND", "快照图片不存在", 404)
        path = path_for(image.storage_key)
    if not path.is_file():
        raise AppError("MEDIA_MISSING", "快照图片文件缺失", 404)
    return FileResponse(
        path, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"}
    )
