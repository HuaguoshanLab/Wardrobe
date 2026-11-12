from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Query, Request, Response, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.jobs import Key
from app.core.errors import AppError, request_id
from app.schemas.common import Envelope
from app.schemas.jobs import JobAccepted
from app.schemas.reference import ReferenceConfirm, ReferenceVersion, ReferenceView
from app.services.reference import records
from app.services.reference.submit import submit

router = APIRouter(prefix="/references", tags=["reference"])


@router.post("", status_code=201)
async def upload(
    request: Request, key: Key, file: Annotated[UploadFile, File()]
) -> Envelope[ReferenceView]:
    try:
        data = await file.read(20 * 1024 * 1024 + 1)
        if len(data) > 20 * 1024 * 1024:
            raise AppError("UPLOAD_LIMIT", "参考图不得超过20 MiB", 413)
        result = await run_in_threadpool(records.upload, data, key)
        return Envelope(data=result, request_id=request_id(request))
    finally:
        await file.close()


@router.get("")
def listing(
    request: Request, offset: int = Query(default=0, ge=0)
) -> Envelope[list[ReferenceView]]:
    return Envelope(data=records.listing(offset), request_id=request_id(request))


@router.get("/{ref_id}")
def get(request: Request, ref_id: UUID) -> Envelope[ReferenceView]:
    return Envelope(data=records.get(ref_id), request_id=request_id(request))


@router.get("/{ref_id}/image")
def image(ref_id: UUID) -> Response:
    return Response(
        records.image_bytes(ref_id), media_type="image/png", headers={"Cache-Control": "no-store"}
    )


@router.patch("/{ref_id}")
def confirm(
    request: Request, ref_id: UUID, payload: ReferenceConfirm, key: Key
) -> Envelope[ReferenceView]:
    return Envelope(data=records.mutate(ref_id, payload, key), request_id=request_id(request))


@router.delete("/{ref_id}")
def delete(
    request: Request, ref_id: UUID, payload: ReferenceVersion, key: Key
) -> Envelope[ReferenceView]:
    return Envelope(data=records.mutate(ref_id, payload, key, True), request_id=request_id(request))


@router.post("/{ref_id}/analyze", status_code=202)
def analyze(
    request: Request, ref_id: UUID, payload: ReferenceVersion, key: Key
) -> Envelope[JobAccepted]:
    return Envelope(data=submit(ref_id, payload, key, "analyze"), request_id=request_id(request))


@router.post("/{ref_id}/generate", status_code=202)
def generate(
    request: Request, ref_id: UUID, payload: ReferenceVersion, key: Key
) -> Envelope[JobAccepted]:
    return Envelope(data=submit(ref_id, payload, key, "generate"), request_id=request_id(request))
