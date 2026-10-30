from datetime import date
from typing import Literal

from pydantic import Field

from app.schemas.common import Schema

RotationMode = Literal["normal", "avoid_recent", "less_worn"]


class WornCombination(Schema):
    garment_ids: list[str]
    body_ids: list[str]


class RotationSnapshot(Schema):
    as_of: date
    timezone: str = "Asia/Shanghai"
    start_7: date
    start_30: date
    records_7: int = 0
    records_30: int = 0
    days_7: int = 0
    days_30: int = 0
    garment_days: dict[str, int] = Field(default_factory=dict)
    combinations: list[WornCombination] = Field(default_factory=list)
