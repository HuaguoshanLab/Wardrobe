from datetime import date, datetime
from typing import Literal
from uuid import UUID

from app.schemas.common import Schema

UsageRange = Literal["30", "90", "all"]
UsageView = Literal["worn", "unrecorded"]


class UsageItem(Schema):
    garment_id: UUID
    name: str | None
    category: str | None
    image_url: str | None
    availability: Literal["available", "unavailable"]
    created_at: datetime
    wear_days: int
    last_worn_on: date | None


class UsageReport(Schema):
    range: UsageRange
    view: UsageView
    as_of: date
    window_start: date | None
    timezone: Literal["Asia/Shanghai"] = "Asia/Shanghai"
    total_garments: int
    recorded_garments: int
    unrecorded_garments: int
    recorded_ratio: float | None
    items: list[UsageItem]
    total_items: int
    offset: int
    limit: int
    next_offset: int | None
