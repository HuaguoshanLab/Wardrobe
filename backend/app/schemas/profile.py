from typing import Literal
from uuid import UUID

from pydantic import Field, ValidationInfo, field_validator

from app.domain.taxonomy import TAXONOMY
from app.schemas.common import Schema
from app.schemas.weather import ManualWeather


class Preferences(Schema):
    style_codes: list[str] = Field(default_factory=list, max_length=8)
    fit: Literal["fitted", "regular", "loose"] | None = None
    thermal: Literal["cold_sensitive", "heat_sensitive", "neutral"] | None = None
    preferred_colors: list[str] = Field(default_factory=list, max_length=15)
    avoided_colors: list[str] = Field(default_factory=list, max_length=15)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("style_codes", "preferred_colors", "avoided_colors")
    @classmethod
    def vocabulary(cls, value: list[str], info: ValidationInfo) -> list[str]:
        field = info.field_name
        choices = TAXONOMY["style_codes" if field == "style_codes" else "color_codes"]
        if any(item not in choices for item in value):
            raise ValueError("未知词表值")
        return list(dict.fromkeys(value))


class PreferencesView(Schema):
    preferences: Preferences
    version: int


class PreferencesPatch(Schema):
    expected_version: int = Field(ge=1)
    preferences: Preferences


class Requirements(Schema):
    occasion_codes: list[str] = Field(default_factory=list, max_length=8)
    style_codes: list[str] | None = Field(default=None, max_length=8)
    season_codes: list[str] = Field(default_factory=list, max_length=4)
    custom_tag_ids: list[UUID] = Field(default_factory=list, max_length=30)
    notes: str | None = Field(default=None, max_length=1000)
    weather_override: ManualWeather | None = None

    @field_validator("occasion_codes", "style_codes", "season_codes")
    @classmethod
    def vocabulary(cls, value: list[str] | None, info: ValidationInfo) -> list[str] | None:
        field = info.field_name
        choices = TAXONOMY["seasons" if field == "season_codes" else str(field)]
        if value is not None and any(item not in choices for item in value):
            raise ValueError("未知词表值")
        return list(dict.fromkeys(value)) if value is not None else None


class ConditionPreview(Schema):
    requirements: Requirements
    effective_preferences: Preferences
    preference_version: int
