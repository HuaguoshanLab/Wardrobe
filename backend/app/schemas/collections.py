from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import Field, field_validator

from app.db.models import utcnow
from app.schemas.common import Schema
from app.schemas.outfits import RevisionView


def today() -> date:
    return utcnow().astimezone(ZoneInfo("Asia/Shanghai")).date()


class FavoriteCreate(Schema):
    revision_id: UUID
    name: str = Field(default="", max_length=100)


class FavoritePatch(Schema):
    expected_version: int = Field(ge=1)
    name: str = Field(max_length=100)


class WearCreate(Schema):
    revision_id: UUID
    worn_on: date = Field(default_factory=today)
    notes: str = Field(default="", max_length=1000)

    @field_validator("worn_on")
    @classmethod
    def actual_date(cls, value: date) -> date:
        if value > today():
            raise ValueError("实际穿着不能记在未来日期")
        return value


class WearPatch(Schema):
    expected_version: int = Field(ge=1)
    worn_on: date
    notes: str = Field(max_length=1000)

    @field_validator("worn_on")
    @classmethod
    def actual_date(cls, value: date) -> date:
        return WearCreate.actual_date(value)


class HistoryEntry(Schema):
    revision: RevisionView
    version: int
    hidden_from_history_at: datetime | None


class FavoriteView(Schema):
    id: UUID
    revision_id: UUID
    name: str
    version: int
    created_at: datetime
    revision: RevisionView


class WearView(Schema):
    id: UUID
    revision_id: UUID
    worn_on: date
    timezone: str
    notes: str
    version: int
    created_at: datetime
    revision: RevisionView


class HistoryList(Schema):
    items: list[HistoryEntry]
    next_cursor: UUID | None


class FavoriteList(Schema):
    items: list[FavoriteView]
    next_cursor: UUID | None


class WearList(Schema):
    items: list[WearView]
    next_cursor: UUID | None


class Deleted(Schema):
    id: UUID
    message: str
