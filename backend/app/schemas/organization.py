from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.common import Schema
from app.schemas.lifecycle import actual_date

SupplyStatus = Literal["planned", "purchased", "completed", "cancelled"]
DecisionState = Literal["suggested", "observe", "pending", "keep", "repair", "done", "undecided"]


class SourceView(Schema):
    id: UUID
    season: str
    name: str
    active: bool


class SupplyInput(Schema):
    expected_version: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=80)
    quantity: int = Field(ge=1, le=10000, strict=True)
    budget: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    reason: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=2000)
    status: Literal["planned", "purchased"] = "planned"
    source_ids: list[UUID] = Field(default_factory=list, max_length=400)


class LinkedGarment(Schema):
    id: UUID
    name: str
    archived: bool


class SupplyView(Schema):
    id: UUID
    version: int
    name: str
    quantity: int
    budget: str | None
    reason: str
    notes: str
    status: SupplyStatus
    cancelled_quantity: int
    remaining: int
    sources: list[SourceView]
    linked: list[LinkedGarment]


class SupplyPage(Schema):
    items: list[SupplyView]
    next_cursor: UUID | None


class VersionInput(Schema):
    expected_version: int = Field(ge=1)


class LinkInput(VersionInput):
    garment_id: UUID
    garment_version: int = Field(ge=1)


class Shortage(Schema):
    source: SourceView
    difference: int
    planned: int
    needs_attention: int


class Candidate(Schema):
    garment_id: UUID
    garment_version: int
    name: str
    image_url: str
    reason_key: str
    reason: str
    decision_version: int
    state: DecisionState
    note: str
    current: bool
    archived: bool


class OrganizationView(Schema):
    shortages: list[Shortage]
    candidates: list[Candidate]
    next_cursor: str | None
    stats_at: datetime


class DecisionInput(Schema):
    expected_version: int = Field(ge=0)
    garment_version: int = Field(ge=1)
    reason_key: str = Field(min_length=1, max_length=200)
    note: str = Field(default="", max_length=500)
    state: Literal["observe", "pending", "keep", "undecided"]


class ExitImpactRow(Schema):
    source: SourceView
    lower: int | None
    upper: int | None
    before_confirmed: int
    after_confirmed: int
    before_pending: int
    after_pending: int
    conclusion: str
    difference: int | None


class ExitImpact(Schema):
    garment_id: UUID
    garment_version: int
    token: str
    rows: list[ExitImpactRow]
    invalid_sources: list[SourceView]


class ProcessInput(Schema):
    garment_version: int = Field(ge=1)
    action: Literal["repair", "gifted", "sold", "recycled", "discarded", "other"]
    occurred_on: date
    reason: str = Field(default="", max_length=500)
    impact_token: str | None = None

    _date = field_validator("occurred_on")(actual_date)
