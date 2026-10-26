import os
import tempfile
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Request, UploadFile
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.core.errors import AppError, request_id
from app.core.maintenance import control_root
from app.schemas.backups import RestoreApply, RestoreView
from app.schemas.common import Envelope
from app.schemas.jobs import JobAccepted
from app.services import backups

router = APIRouter()
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]


@router.post("/backups", status_code=202)
def create(request: Request, key: Key) -> Envelope[JobAccepted]:
    return Envelope(data=backups.create(key), request_id=request_id(request))


@router.get("/backups/{backup_id}/download")
def download(backup_id: UUID) -> FileResponse:
    return FileResponse(
        backups.download(backup_id),
        filename=f"wardrobe-{backup_id}.zip",
        media_type="application/zip",
    )


@router.post("/restores/validate", status_code=202)
def validate(request: Request, file: UploadFile, key: Key) -> Envelope[RestoreView]:
    fd, name = tempfile.mkstemp(prefix="upload-", dir=control_root())
    path = Path(name)
    try:
        size = 0
        with os.fdopen(fd, "wb") as stream:
            while chunk := file.file.read(1024**2):
                size += len(chunk)
                if size > get_settings().backup_max_bytes:
                    raise AppError("BACKUP_LIMIT", "备份上传超过大小限制", 413)
                stream.write(chunk)
            stream.flush()
            os.fsync(stream.fileno())
        return Envelope(data=backups.accept_upload(path, key), request_id=request_id(request))
    finally:
        path.unlink(missing_ok=True)


@router.get("/restores/{restore_id}")
def get(request: Request, restore_id: UUID) -> Envelope[RestoreView]:
    return Envelope(data=backups.restore_view(restore_id), request_id=request_id(request))


@router.post("/restores/{restore_id}/apply", status_code=202)
def apply(
    request: Request, restore_id: UUID, payload: RestoreApply, key: Key
) -> Envelope[JobAccepted]:
    return Envelope(data=backups.apply(restore_id, payload, key), request_id=request_id(request))
