from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.schemas.collections import WearView, today
from app.schemas.common import Schema
from app.schemas.outfits import RevisionView


class ManualItem(Schema):
    garment_id: UUID
    expected_version: int = Field(ge=1)


class ManualOutfitInput(Schema):
    items: list[ManualItem] = Field(min_length=1, max_length=20)
    mode: Literal["save", "wear"]
    parent_revision_id: UUID | None = None
    worn_on: date | None = None
    notes: str = Field(default="", max_length=1000)
    acknowledged_unavailable_ids: list[UUID] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def coherent(self) -> "ManualOutfitInput":
        if len({i.garment_id for i in self.items}) != len(self.items):
            raise ValueError("同一单品只能选择一次")
        if self.mode == "wear":
            if self.worn_on is None or self.worn_on > today():
                raise ValueError("请选择今天或过去的实际穿着日期")
        elif self.worn_on is not None or self.notes or self.acknowledged_unavailable_ids:
            raise ValueError("保存搭配不能附带穿着记录或不可用确认")
        return self


class ManualOutfitResult(Schema):
    revision: RevisionView
    wear: WearView | None = None
