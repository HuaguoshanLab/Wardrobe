from typing import Literal

from pydantic import Field

from app.schemas.common import Schema

LocationMode = Literal["all", "named", "unassigned"]


class LocationCount(Schema):
    location: str
    count: int = Field(ge=1)


class LocationList(Schema):
    items: list[LocationCount]
    next_cursor: str | None
    total_garments: int = Field(ge=0)
    unassigned_count: int = Field(ge=0)
    matching_locations: int = Field(ge=0)
