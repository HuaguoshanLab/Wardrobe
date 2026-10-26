from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Request, Response, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.jobs import Key
from app.core.errors import AppError, request_id
from app.media.excel import template
from app.media.storage import remove_keys, store_bytes
from app.schemas.common import Envelope
from app.schemas.wardrobe import (
    BatchView,
    Confirmation,
    ConfirmInput,
    ImportAccepted,
    RowPatch,
    RowView,
    StepRetry,
)
from app.services.import_review import confirm, patch_row, read_batch
from app.services.import_submit import retry_step, submit_import

router = APIRouter()


@router.get("/imports/template")
def download_template() -> Response:
    return Response(
        template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="wardrobe-template-v1.xlsx"'},
    )


async def upload(
    request: Request, files: list[UploadFile], key: str, source: str
) -> Envelope[ImportAccepted]:
    if not files or len(files) > (1 if source == "excel" else 20):
        raise AppError("UPLOAD_LIMIT", "照片最多 20 张，Excel 每次一份", 413)
    stored: list[dict[str, str]] = []
    total = 0
    committed = False
    try:
        for file in files:
            name = (file.filename or "upload").replace("\\", "/").split("/")[-1][:200]
            if source == "excel" and not name.lower().endswith(".xlsx"):
                raise AppError("INVALID_EXTENSION", "只支持 .xlsx 模板", 422)
            limit = (50 if source == "excel" else 20) * 1024 * 1024
            data = bytearray()
            while chunk := await file.read(1024 * 1024):
                data.extend(chunk)
                total += len(chunk)
                if len(data) > limit or total > 200 * 1024 * 1024:
                    raise AppError("UPLOAD_LIMIT", "上传超过单文件或总大小限制", 413)
            media_key, sha = await run_in_threadpool(store_bytes, bytes(data))
            stored.append({"key": media_key, "sha256": sha, "name": name})
        result, committed = await run_in_threadpool(submit_import, source, stored, key)
        return Envelope(data=result, request_id=request_id(request))
    finally:
        for file in files:
            await file.close()
        if not committed:
            await run_in_threadpool(remove_keys, [f["key"] for f in stored])


@router.post("/imports/photos", response_model=Envelope[ImportAccepted], status_code=202)
async def photos(
    request: Request, idempotency_key: Key, files: Annotated[list[UploadFile], File()]
) -> Envelope[ImportAccepted]:
    return await upload(request, files, idempotency_key, "photos")


@router.post("/imports/excel", response_model=Envelope[ImportAccepted], status_code=202)
async def excel(
    request: Request, idempotency_key: Key, file: Annotated[UploadFile, File()]
) -> Envelope[ImportAccepted]:
    return await upload(request, [file], idempotency_key, "excel")


@router.get("/imports/{batch_id}", response_model=Envelope[BatchView])
def batch(request: Request, batch_id: UUID) -> Envelope[BatchView]:
    return Envelope(data=read_batch(batch_id), request_id=request_id(request))


@router.patch("/imports/{batch_id}/rows/{row_id}", response_model=Envelope[RowView])
def edit_row(
    request: Request, batch_id: UUID, row_id: UUID, payload: RowPatch
) -> Envelope[RowView]:
    return Envelope(data=patch_row(batch_id, row_id, payload), request_id=request_id(request))


@router.post("/imports/{batch_id}/confirm", response_model=Envelope[Confirmation])
def confirmation(
    request: Request, batch_id: UUID, payload: ConfirmInput, idempotency_key: Key
) -> Envelope[Confirmation]:
    return Envelope(
        data=confirm(batch_id, payload, idempotency_key), request_id=request_id(request)
    )


@router.post(
    "/imports/{batch_id}/rows/{row_id}/retry",
    status_code=202,
    response_model=Envelope[ImportAccepted],
)
def retry(
    request: Request, batch_id: UUID, row_id: UUID, payload: StepRetry, idempotency_key: Key
) -> Envelope[ImportAccepted]:
    return Envelope(
        data=retry_step(batch_id, row_id, payload.step, idempotency_key),
        request_id=request_id(request),
    )
