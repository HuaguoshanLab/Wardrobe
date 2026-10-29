from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.schemas.common import Schema

Season = Literal["spring", "summer", "autumn", "winter"]
Quantity = Annotated[int, Field(strict=True, ge=0, le=10000)]


class RotationInputs(Schema):
    weekly_days: int = Field(strict=True, ge=0, le=7)
    laundry_days: int = Field(strict=True, ge=1, le=60)
    drying_days: int = Field(strict=True, ge=0, le=30)
    repeat_wears: int = Field(strict=True, ge=1, le=100)
    spare: int = Field(strict=True, ge=0, le=100)


class EstimateInput(RotationInputs):
    category: str
    occasion_codes: list[str] = Field(default_factory=list, max_length=8)


class EstimateView(Schema):
    lower: int
    explanation: str


class DemandSpec(Schema):
    id: UUID
    name: str = Field(min_length=1, max_length=80)
    category: str
    subtype_ids: list[UUID] = Field(default_factory=list, max_length=100)
    occasion_codes: list[str] = Field(default_factory=list, max_length=8)
    tag_ids: list[UUID] = Field(default_factory=list, max_length=100)
    lower: Quantity | None = None
    upper: Quantity | None = None
    notes: str = Field(default="", max_length=1000)
    enabled: bool = True
    estimate: RotationInputs | None = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("需求名称不能为空")
        return value.strip()

    @model_validator(mode="after")
    def limits(self) -> Self:
        if (self.lower is None) != (self.upper is None):
            raise ValueError("目标上下限需要同时填写或同时留空")
        if self.lower is not None and self.upper is not None and self.lower > self.upper:
            raise ValueError("目标下限不能大于上限")
        return self


class PlanFields(Schema):
    city: str = Field(default="", max_length=80)
    period: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=1000)
    rows: list[DemandSpec] = Field(default_factory=list, max_length=100)

    @field_validator("rows")
    @classmethod
    def unique_rows(cls, value: list[DemandSpec]) -> list[DemandSpec]:
        if len({r.id for r in value}) != len(value):
            raise ValueError("需求行 ID 不可重复")
        return value


class PlanInput(PlanFields):
    expected_version: int = Field(ge=0)


class PlanView(PlanFields):
    season: Season
    version: int


class Coverage(Schema):
    id: UUID
    season: Season
    name: str


class InventoryMember(Schema):
    garment_id: UUID
    bucket: Literal["confirmed", "pending", "excluded"]
    reasons: list[str]
    covered_by: list[Coverage] = Field(default_factory=list)


class InventoryCount(Schema):
    row_id: UUID
    planned: int = 0
    matched_owned: int
    confirmed: int
    pending: int
    unavailable: int
    available: int
    needs_attention: int
    shared: int
    conclusion: Literal["unset", "review", "shortage", "enough", "excess", "invalid", "disabled"]
    difference: int | None
    rule_errors: list[str]
    members: list[InventoryMember]


class InventoryGarment(Schema):
    id: UUID
    name: str
    image_url: str
    version: int


class InventoryView(Schema):
    plan: PlanView
    stats_at: datetime
    config_versions: dict[str, int]
    total_owned: int
    counts: list[InventoryCount]
    garments: list[InventoryGarment]
