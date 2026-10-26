from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, JsonValue

from app.schemas.common import ErrorDetail, Schema

JobStatus = Literal[
    "queued", "running", "cancel_requested", "succeeded", "failed", "interrupted", "cancelled"
]
TERMINAL = {"succeeded", "failed", "interrupted", "cancelled"}


class DiagnosticInput(Schema):
    message: str = Field(default="验证基础任务流程", min_length=1, max_length=200)
    delay_seconds: float = Field(default=1, ge=0, le=15)
    scenario: Literal["success", "failure"] = "success"


class DiagnosticResult(Schema):
    provider_mode: Literal["fake"] = "fake"
    message: str


class ImportResult(Schema):
    import_batch_id: UUID
    row_counts: dict[str, int]
    failed_steps: int


class MediaResult(Schema):
    import_row_id: UUID
    image_asset_id: UUID
    step: Literal["conversion", "analysis", "cutout"]
    status: str


class JobView(Schema):
    id: UUID
    kind: Literal[
        "diagnostic",
        "import_photos",
        "import_excel",
        "media_convert",
        "media_cutout",
        "garment_recognize",
    ]
    status: JobStatus
    result: DiagnosticResult | ImportResult | MediaResult | None
    error: ErrorDetail | None
    retry_of_job_id: UUID | None
    last_seq: int
    created_at: datetime
    updated_at: datetime


class JobAccepted(Schema):
    job_id: UUID
    status: JobStatus


class EventView(Schema):
    schema_version: Literal[1] = 1
    job_id: UUID
    seq: int
    type: Literal["status", "progress", "result", "error"]
    occurred_at: datetime
    payload: dict[str, JsonValue]
