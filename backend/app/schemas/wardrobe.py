from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, JsonValue

from app.schemas.common import Schema


class Attributes(Schema):
    category: str | None = Field(default=None, max_length=40)
    name: str | None = Field(default=None, max_length=100)
    color_codes: list[str] = Field(default_factory=list, max_length=20)
    seasons: list[str] = Field(default_factory=list, max_length=4)
    occasion_codes: list[str] = Field(default_factory=list, max_length=20)
    style_codes: list[str] = Field(default_factory=list, max_length=20)
    material: str | None = Field(default=None, max_length=40)
    thickness: str | None = Field(default=None, max_length=40)
    warmth: str | None = Field(default=None, max_length=40)
    custom_tag_ids: list[UUID] = Field(default_factory=list, max_length=30)
    availability: Literal["available", "unavailable"] = "available"
    display_variant: Literal["original", "cutout"] = "original"


class GarmentView(Attributes):
    id: UUID
    image_asset_id: UUID
    is_demo: bool
    version: int
    created_at: datetime
    image_url: str
    has_cutout: bool


class GarmentList(Schema):
    items: list[GarmentView]
    next_cursor: UUID | None


class AttributePatch(Schema):
    expected_version: int = Field(ge=1)
    changes: dict[str, JsonValue]


class RowPatch(AttributePatch):
    skip: bool = False


class TagInput(Schema):
    name: str = Field(min_length=1, max_length=40)


class TagPatch(TagInput):
    expected_version: int = Field(ge=1)


class TagView(Schema):
    id: UUID
    name: str
    version: int


class RowView(Schema):
    id: UUID
    row_number: int
    filename: str
    image_asset_id: UUID | None
    image_url: str | None
    has_cutout: bool
    draft: Attributes
    version: int
    touched_fields: list[str]
    validation_errors: list[str]
    processing_errors: dict[str, JsonValue]
    row_status: Literal["invalid", "ready", "confirmed", "skipped"]
    conversion_status: str
    analysis_status: str
    cutout_status: str
    analysis_notes: list[str]
    analysis_source: str | None
    confirmed_garment_id: UUID | None


class BatchView(Schema):
    id: UUID
    source: str
    parent_job_id: UUID
    job_status: str
    job_error: str | None
    rows: list[RowView]


class ImportAccepted(Schema):
    import_batch_id: UUID
    job_id: UUID
    status: str


class ConfirmRow(Schema):
    row_id: UUID
    expected_version: int = Field(ge=1)


class ConfirmInput(Schema):
    rows: list[ConfirmRow] = Field(min_length=1, max_length=100)


class ConfirmOutcome(Schema):
    row_id: UUID
    status: Literal["confirmed", "already_confirmed", "invalid", "version_conflict"]
    garment_id: UUID | None = None
    errors: list[str] = Field(default_factory=list)


class Confirmation(Schema):
    rows: list[ConfirmOutcome]


class StepRetry(Schema):
    step: Literal["conversion", "analysis", "cutout"]
