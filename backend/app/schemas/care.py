from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.schemas.common import Schema
from app.schemas.wardrobe import GarmentView

CareAction = Literal[
    "mark_washing", "wash_done", "tags_add", "tags_remove", "location_set", "location_clear"
]


class CareItem(Schema):
    id: UUID
    garment_id: UUID
    expected_version: int = Field(ge=1)
    action: CareAction
    tag_ids: list[UUID] = Field(default_factory=list, max_length=30)
    location: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def specific_fields(self) -> "CareItem":
        if len(set(self.tag_ids)) != len(self.tag_ids):
            raise ValueError("标签不能重复")
        if self.action in {"tags_add", "tags_remove"}:
            if not self.tag_ids:
                raise ValueError("请选择要添加或移除的标签")
        elif self.tag_ids:
            raise ValueError("此操作不接受标签")
        if self.action == "location_set":
            if self.location is None or not self.location.strip():
                raise ValueError("请填写位置，清空位置需使用独立动作")
            self.location = self.location.strip()
        elif self.location is not None:
            raise ValueError("此操作不接受位置")
        return self


class CareBatch(Schema):
    items: list[CareItem] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def unique_items(self) -> "CareBatch":
        if len({i.id for i in self.items}) != len(self.items):
            raise ValueError("单项操作 ID 不可重复")
        if len({i.garment_id for i in self.items}) != len(self.items):
            raise ValueError("每批只能对同一件衣服执行一个动作")
        return self


class CareOutcome(Schema):
    id: UUID
    garment_id: UUID
    success: bool
    changed: bool = False
    code: str
    message: str
    garment: GarmentView | None = None


class CareResult(Schema):
    items: list[CareOutcome]
