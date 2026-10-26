"""Durable control records deliberately live outside the restored database."""

import fcntl
import hashlib
import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from pydantic import Field, JsonValue

from app.core.errors import AppError
from app.core.maintenance import control_root
from app.db.models import utcnow
from app.schemas.backups import BackupResult
from app.schemas.common import ErrorDetail, Schema
from app.schemas.jobs import EventView, JobView


class Control(Schema):
    id: UUID = Field(default_factory=uuid4)
    kind: Literal["backup_export", "backup_restore"]
    status: str = "queued"
    phase: str = "queued"
    key: str = ""
    request_hash: str = ""
    message: str = "等待处理"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    events: list[EventView] = Field(default_factory=list)
    result: BackupResult | None = None
    error: ErrorDetail | None = None
    sha256: str | None = None
    epoch: UUID | None = None
    new_epoch: UUID | None = None
    token: str | None = None
    expires_at: datetime | None = None
    summary: dict[str, int] = Field(default_factory=dict)
    apply_key: str | None = None
    apply_hash: str | None = None
    stage_database: str | None = None


def directory(control_id: UUID) -> Path:
    path = control_root() / str(control_id)
    path.mkdir(exist_ok=True)
    return path


def atomic(path: Path, data: bytes) -> None:
    temporary = path.with_name(path.name + f".{uuid4().hex}.tmp")
    with temporary.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save(record: Control) -> None:
    atomic(directory(record.id) / "state.json", record.model_dump_json().encode())


def read(control_id: UUID) -> Control | None:
    path = control_root() / str(control_id) / "state.json"
    return Control.model_validate_json(path.read_bytes()) if path.exists() else None


def all_records() -> list[Control]:
    return [
        Control.model_validate_json(p.read_bytes()) for p in control_root().glob("*/state.json")
    ]


@contextmanager
def registry() -> Iterator[None]:
    with (control_root() / "registry.lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def event(
    record: Control,
    kind: Literal["status", "progress", "result", "error"],
    payload: dict[str, JsonValue],
) -> None:
    record.updated_at = utcnow()
    record.events.append(
        EventView(
            job_id=record.id,
            seq=len(record.events) + 1,
            type=kind,
            occurred_at=record.updated_at,
            payload=payload,
        )
    )
    save(record)


def job(record: Control) -> JobView:
    if record.kind == "backup_restore" and record.apply_key is None:
        raise AppError("RESTORE_NOT_APPLIED", "请通过恢复验证接口查询，尚未确认覆盖", 409)
    return JobView.model_validate(
        dict(
            id=record.id,
            kind=record.kind,
            status=record.status,
            result=record.result,
            error=record.error,
            retry_of_job_id=None,
            last_seq=len(record.events),
            created_at=record.created_at,
            updated_at=record.updated_at,
        )
    )


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require(control_id: UUID, kind: str | None = None) -> Control:
    record = read(control_id)
    if record is None or (kind and record.kind != kind):
        raise AppError("NOT_FOUND", "维护任务不存在", 404)
    return record
