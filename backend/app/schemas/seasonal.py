from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.schemas.common import Schema
from app.schemas.inventory import InventoryView, Season
from app.schemas.lifecycle import LifecycleInput
from app.schemas.wardrobe import GarmentView

Stage = Literal["review", "targets", "actions", "summary"]


class SeasonalCreate(Schema):
    id: UUID
    season: Season
    scope: Literal["all", "season"] = "season"
    categories: list[str] = Field(default_factory=list, max_length=30)


class SeasonalBrief(Schema):
    id: UUID
    season: Season
    scope: Literal["all", "season"]
    categories: list[str]
    version: int
    stage: Stage
    created_at: datetime
    completed_at: datetime | None


class SeasonalPage(Schema):
    items: list[SeasonalBrief]
    next_cursor: UUID | None


class ReviewInput(Schema):
    garment_id: UUID
    garment_version: int = Field(ge=1)
    reviewed: bool
    todo: str = Field(default="", max_length=500)


class ProgressInput(Schema):
    expected_version: int = Field(ge=1)
    stage: Stage
    items: list[ReviewInput] = Field(default_factory=list, max_length=100)
    target_token: str | None = None


class SeasonalItemView(Schema):
    garment_id: UUID
    original: GarmentView
    current: GarmentView | None
    reviewed_version: int | None
    stale: bool
    todo: str


class ActionInput(Schema):
    id: UUID
    garment_id: UUID
    operation: LifecycleInput

    @model_validator(mode="after")
    def allowed(self) -> "ActionInput":
        op = self.operation
        if op.action not in {"storage", "repair_start", "decision", "retire"}:
            raise ValueError("此流程仅执行收纳、维修、保留或退出")
        if op.action == "decision" and (
            op.changes.get("decision") != "keep" or not op.changes.get("decision_reason")
        ):
            raise ValueError("保留需填写原因")
        return self


class BatchInput(Schema):
    items: list[ActionInput] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def unique(self) -> "BatchInput":
        if len({i.garment_id for i in self.items}) != len(self.items):
            raise ValueError("一次只对每件单品执行一个动作")
        if len({i.id for i in self.items}) != len(self.items):
            raise ValueError("操作 ID 不可重复")
        return self


class ActionResult(Schema):
    id: UUID
    garment_id: UUID
    operation: LifecycleInput
    success: bool
    message: str
    garment: GarmentView | None = None


class BatchResult(Schema):
    items: list[ActionResult]


class SeasonalSummary(Schema):
    stats_at: datetime
    rules_token: str
    inventory: InventoryView
    items: list[SeasonalItemView]
    actions: list[ActionResult]
    reviewed: int
    total: int
    unresolved: list[str]
    outside_scope: int


class SeasonalView(SeasonalBrief):
    items: list[SeasonalItemView]
    inventory: InventoryView
    actions: list[ActionResult]
    target_token: str
    targets_confirmed: bool
    preview_token: str
    preview: SeasonalSummary
    summary: SeasonalSummary | None


class CompleteInput(Schema):
    expected_version: int = Field(ge=1)
    preview_token: str
    acknowledge_unresolved: bool = False
