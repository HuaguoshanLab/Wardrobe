"""Independent multi-day travel protocol; ordinary outfits remain capped at three."""

from datetime import date, datetime, timedelta
from uuid import UUID

from pydantic import Field, JsonValue, field_validator, model_validator

from app.domain.taxonomy import TAXONOMY
from app.schemas.common import Schema
from app.schemas.outfits import ItemSnapshot
from app.schemas.weather import City, ManualWeather


class TravelDayInput(Schema):
    date: date
    occasion: str = "daily"
    weather: ManualWeather | None = None

    @field_validator("occasion")
    @classmethod
    def occasion_known(cls, value: str) -> str:
        if value not in TAXONOMY["occasion_codes"]:
            raise ValueError("请选择已支持的场合")
        return value


class TravelInput(Schema):
    name: str = Field(min_length=1, max_length=60)
    city: City
    days: list[TravelDayInput] = Field(min_length=1, max_length=7)
    required_garment_ids: list[UUID] = Field(default_factory=list, max_length=20)
    target_count: int = Field(default=10, ge=1, le=50)
    allow_repeat: bool = True
    notes: str = Field(default="", max_length=1000)

    @field_validator("name")
    @classmethod
    def trimmed(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("请输入行程名称")
        return value.strip()

    @model_validator(mode="after")
    def consecutive(self) -> "TravelInput":
        if any(
            day.date != self.days[0].date + timedelta(days=i) for i, day in enumerate(self.days)
        ):
            raise ValueError("行程须为 1～7 个连续且不重复的日期")
        if len(set(self.required_garment_ids)) != len(self.required_garment_ids):
            raise ValueError("必带单品不能重复")
        return self


class TravelVersion(Schema):
    expected_version: int = Field(ge=1)


class TravelUpdate(TravelInput):
    expected_version: int = Field(ge=1)


class TravelGenerate(TravelVersion):
    adjust_date: date | None = None
    message: str = Field(default="", max_length=1000)


class TravelPack(TravelVersion):
    garment_id: UUID
    packed: bool


class TravelWear(Schema):
    revision_id: UUID
    day: date
    notes: str = Field(default="", max_length=1000)


class TravelWearResult(Schema):
    wear_record_id: UUID
    outfit_revision_id: UUID


class ModelTravelDay(Schema):
    date: date
    garment_ids: list[UUID] = Field(min_length=1, max_length=20)


class ModelTravel(Schema):
    days: list[ModelTravelDay] = Field(min_length=1, max_length=7)


class TravelDay(Schema):
    date: date
    occasion: str
    items: list[ItemSnapshot]
    weather: dict[str, JsonValue]
    warnings: list[str]


class TravelRevisionView(Schema):
    id: UUID
    number: int
    days: list[TravelDay]
    request: TravelInput
    provider_mode: str
    warnings: list[str]
    created_at: datetime


class PackingItem(Schema):
    garment_id: UUID
    item: ItemSnapshot
    dates: list[date]
    packed: bool
    added: bool


class TravelView(Schema):
    id: UUID
    version: int
    draft: TravelInput
    current_job_id: UUID | None
    revision: TravelRevisionView | None
    packing: list[PackingItem]
    created_at: datetime


class TravelResult(Schema):
    travel_id: UUID
    travel_revision_id: UUID
