from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, JsonValue, model_validator

from app.domain.taxonomy import TAXONOMY
from app.schemas.common import Schema
from app.schemas.profile import Requirements


class SessionCreate(Schema):
    requirements: Requirements = Field(default_factory=Requirements)
    base_revision_id: UUID | None = None


class SessionPatch(Schema):
    expected_version: int = Field(ge=1)
    requirements: Requirements | None = None
    selected_revision_id: UUID | None = None
    locked_garment_ids: list[UUID] | None = Field(default=None, max_length=20)


class GenerateInput(Schema):
    expected_version: int = Field(ge=1)


class AdjustInput(GenerateInput):
    base_revision_id: UUID
    scope: Literal["replace_items", "rebuild_unlocked", "chat"]
    target_item_ids: list[UUID] = Field(default_factory=list, max_length=20)
    message: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def explicit_target(self) -> "AdjustInput":
        if self.scope == "replace_items" and not self.target_item_ids:
            raise ValueError("请选择替换项")
        if self.scope == "chat" and not self.message.strip():
            raise ValueError("请输入调整要求")
        if self.scope != "replace_items" and self.target_item_ids:
            raise ValueError("非局部替换不能附带目标")
        return self


class Suggestion(Schema):
    category: str = Field(
        min_length=1,
        max_length=40,
        json_schema_extra={"enum": list(TAXONOMY["category"])},
    )
    description: str = Field(min_length=1, max_length=300)


class Proposal(Schema):
    garment_ids: list[UUID] = Field(min_length=1, max_length=20)
    reason: str = Field(default="", max_length=2000)
    aesthetic_codes: list[Literal["color_echo", "color_contrast", "simple_palette"]] = Field(
        default_factory=list, max_length=3
    )
    unmet_requirements: list[str] = Field(default_factory=list, max_length=20)
    suggestions: list[Suggestion] = Field(default_factory=list, max_length=10)


class ModelOutfits(Schema):
    outfits: list[Proposal] = Field(default_factory=list, max_length=3)
    message: str = Field(default="", max_length=2000)


class Intent(Schema):
    scope: Literal["replace_items", "rebuild_unlocked", "clarify"]
    target_item_ids: list[UUID] = Field(default_factory=list, max_length=20)
    question: str = Field(default="", max_length=1000)


class OutfitResult(Schema):
    session_id: UUID
    revision_ids: list[UUID] = Field(default_factory=list, max_length=3)
    outcome: Literal["complete", "partial", "no_match", "needs_clarification"]
    unmet_requirements: list[str] = Field(default_factory=list)
    question: str | None = None


class ItemSnapshot(Schema):
    item_id: UUID
    slot: str
    source: Literal["wardrobe", "suggestion"]
    garment_id: UUID | None = None
    display_asset_id: UUID | None = None
    image_url: str | None = None
    attributes: dict[str, JsonValue] = Field(default_factory=dict)
    description: str | None = None


class RevisionView(Schema):
    id: UUID
    session_id: UUID
    parent_revision_id: UUID | None
    run_id: UUID
    items: list[ItemSnapshot]
    reason: str
    unmet_requirements: list[str]
    weather_snapshot: dict[str, JsonValue]
    request_snapshot: dict[str, JsonValue]
    provider_mode: str
    created_at: datetime


class MessageView(Schema):
    id: UUID
    role: Literal["user", "assistant"]
    content: str
    job_id: UUID | None
    revision_ids: list[UUID]
    created_at: datetime


class SessionView(Schema):
    id: UUID
    version: int
    requirements: Requirements
    selected_revision_id: UUID | None
    locked_garment_ids: list[UUID]
    current_job_id: UUID | None
    latest_revision_ids: list[UUID]
    revisions: list[RevisionView]
    messages: list[MessageView]
    invalid_garment_ids: list[UUID] = Field(default_factory=list)
    removed_lock_ids: list[UUID] = Field(default_factory=list)


class MessageList(Schema):
    items: list[MessageView]
    next_cursor: UUID | None


class OutfitContext(Schema):
    requirements: Requirements
    preferences: dict[str, JsonValue]
    preference_version: int
    city: dict[str, JsonValue] | None
    candidates: list[dict[str, JsonValue]]
    tags: dict[str, str]
    base_items: list[ItemSnapshot]
    locked_garment_ids: list[UUID]
    deadline: datetime
    weather: dict[str, JsonValue]
