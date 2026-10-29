from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import Field, JsonValue, field_validator

from app.schemas.common import Schema


def actual_date(value: date) -> date:
    if value > datetime.now(ZoneInfo("Asia/Shanghai")).date():
        raise ValueError("实际发生日期不能在未来")
    return value


class LifecycleProfile(Schema):
    source: Literal["purchased", "gift", "other"] | None = None
    acquired_on: date | None = None
    price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    location: str | None = Field(default=None, max_length=120)
    condition: Literal["unknown", "good", "worn", "needs_repair", "damaged"] = "unknown"
    fit: Literal["unknown", "fits", "unfit", "not_applicable"] = "unknown"
    storage: Literal["daily", "stored"] = "daily"
    unavailable_reason: Literal["washing", "repair", "other"] | None = None
    decision: Literal["undecided", "keep", "pending"] = "undecided"
    decision_reason: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=2000)
    exit_reason: Literal["gifted", "sold", "recycled", "discarded", "other"] | None = None
    exited_on: date | None = None

    @field_validator("acquired_on", "exited_on")
    @classmethod
    def not_future(cls, value: date | None) -> date | None:
        return actual_date(value) if value else None


class LifecycleInput(Schema):
    expected_version: int = Field(ge=1)
    action: Literal[
        "profile",
        "condition",
        "storage",
        "availability",
        "repair_start",
        "repair_complete",
        "decision",
        "retire",
        "restore",
        "correct",
    ]
    occurred_on: date
    reason: str = Field(default="", max_length=500)
    changes: dict[str, JsonValue] = Field(default_factory=dict)
    related_event_id: UUID | None = None
    impact_token: str | None = None

    _date = field_validator("occurred_on")(actual_date)


class EventView(Schema):
    id: UUID
    action: str
    occurred_on: date
    recorded_at: datetime
    reason: str
    version: int
    related_event_id: UUID | None
    before: dict[str, JsonValue]
    after: dict[str, JsonValue]


class LifecycleHistory(Schema):
    last_exit_event_id: UUID | None
    items: list[EventView]
    next_cursor: int | None
    wear_days: int
    first_worn_on: date | None
    last_worn_on: date | None


class SubtypeInput(Schema):
    category: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=40)


class SubtypeView(SubtypeInput):
    id: UUID
    active: bool = True
    version: int = 1


class SubtypeReference(Schema):
    id: UUID
    season: str
    name: str
    enabled: bool


class SubtypeImpact(Schema):
    subtype: SubtypeView
    garment_count: int
    owned_count: int
    rows: list[SubtypeReference]
    token: str


class SubtypePatch(Schema):
    expected_version: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=40)
    active: bool
    impact_token: str = Field(min_length=1)
