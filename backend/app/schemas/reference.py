from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.domain.taxonomy import TAXONOMY
from app.schemas.common import Schema


class ReferenceClue(Schema):
    category: str = Field(json_schema_extra={"enum": list(TAXONOMY["category"])})
    color_codes: list[str] = Field(default_factory=list, max_length=5)
    style_codes: list[str] = Field(default_factory=list, max_length=3)
    layer: Literal["unknown", "inner", "outer", "single"] = "unknown"

    @model_validator(mode="after")
    def vocabulary(self) -> "ReferenceClue":
        for field in ("category", "color_codes", "style_codes"):
            value = getattr(self, field)
            values = value if isinstance(value, list) else [value]
            if any(v not in TAXONOMY[field] for v in values) or len(set(values)) != len(values):
                raise ValueError("线索必须使用不重复的词表值")
        return self


class ReferenceAnalysis(Schema):
    subject: Literal["single", "multiple", "unclear"]
    clues: list[ReferenceClue] = Field(default_factory=list, max_length=12)
    warnings: list[Annotated[str, Field(max_length=300)]] = Field(
        default_factory=list, max_length=8
    )


class ReferenceVersion(Schema):
    expected_version: int = Field(ge=1)


class ReferenceConfirm(ReferenceVersion):
    clues: list[ReferenceClue] = Field(max_length=12)


class ReferenceView(Schema):
    id: UUID
    version: int
    image_url: str
    analysis: ReferenceAnalysis | None
    clues: list[ReferenceClue]
    confirmed: bool
    current_job_id: UUID | None
    revision_ids: list[UUID]
    provider_mode: str | None
    created_at: datetime


class ReferenceResult(Schema):
    reference_id: UUID
    action: Literal["analyze", "generate"]
    revision_ids: list[UUID] = Field(default_factory=list, max_length=3)
    no_match: bool = False


class ReferenceProposal(Schema):
    garment_ids: list[UUID] = Field(min_length=1, max_length=20)


class ReferenceOutfits(Schema):
    outfits: list[ReferenceProposal] = Field(default_factory=list, max_length=3)
