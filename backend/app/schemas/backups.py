from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import Schema


class BackupResult(Schema):
    backup_id: UUID | None = None
    restore_id: UUID | None = None
    format_version: int = 1
    sha256: str | None = None
    download_url: str | None = None
    data_epoch: UUID | None = None
    refresh_required: bool = False
    summary: dict[str, int] = Field(default_factory=dict)


class RestoreView(Schema):
    restore_id: UUID
    status: Literal[
        "validating",
        "ready",
        "invalid",
        "expired",
        "queued",
        "running",
        "succeeded",
        "failed",
        "interrupted",
    ]
    message: str
    sha256: str | None = None
    confirmation_token: str | None = None
    expires_at: datetime | None = None
    target_data_epoch: UUID | None = None
    summary: dict[str, int] = Field(default_factory=dict)
    job_id: UUID | None = None


class RestoreApply(Schema):
    confirmation_token: str = Field(min_length=16, max_length=200)
