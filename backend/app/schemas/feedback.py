from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.schemas.common import Schema


class FeedbackData(Schema):
    garment_id: UUID | None = None
    thermal: Literal["hot", "cold", "just_right"] | None = None
    comfort: Literal["comfortable", "neutral", "uncomfortable"] | None = None
    color: Literal["satisfied", "neutral", "unsatisfied"] | None = None
    notes: str = Field(default="", max_length=500)

    @field_validator("notes")
    @classmethod
    def trim(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def meaningful(self) -> "FeedbackData":
        if not any([self.thermal, self.comfort, self.color, self.notes]):
            raise ValueError("至少选择一种感受或填写备注；清除反馈请使用删除")
        return self


class FeedbackPatch(Schema):
    expected_version: int = Field(ge=0)
    feedback: FeedbackData


class FeedbackView(Schema):
    wear_record_id: UUID
    version: int
    feedback: FeedbackData | None
    updated_at: datetime | None
