from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, JsonValue, ValidationInfo, field_validator

from app.domain.taxonomy import TAXONOMY
from app.schemas.common import Schema


class TemplateConditions(Schema):
    occasion_codes: list[str] = Field(default_factory=list, max_length=8)
    style_codes: list[str] | None = Field(default=None, max_length=8)
    custom_tag_ids: list[UUID] = Field(default_factory=list, max_length=30)
    notes: str | None = Field(default=None, max_length=1000)
    rotation_mode: Literal["normal", "avoid_recent", "less_worn"] = "normal"

    @field_validator("occasion_codes", "style_codes")
    @classmethod
    def vocabulary(cls, value: list[str] | None, info: ValidationInfo) -> list[str] | None:
        if value is not None and any(v not in TAXONOMY[str(info.field_name)] for v in value):
            raise ValueError("未知词表值")
        return list(dict.fromkeys(value)) if value is not None else None


class TemplateCreate(Schema):
    name: str = Field(min_length=1, max_length=60)
    conditions: TemplateConditions

    @field_validator("name", mode="before")
    @classmethod
    def trim(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class TemplateUpdate(TemplateCreate):
    expected_version: int = Field(ge=1)


class TemplateDelete(Schema):
    expected_version: int = Field(ge=1)


class TemplateView(Schema):
    id: UUID
    name: str
    conditions: dict[str, JsonValue]
    version: int
    created_at: datetime
    updated_at: datetime
    issues: list[str]


class TemplateDeleted(Schema):
    id: UUID
    version: int
    deleted: Literal[True] = True
