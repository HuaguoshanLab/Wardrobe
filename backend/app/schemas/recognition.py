"""Model output is a restricted draft, never a Garment mutation."""

from typing import Self

from pydantic import Field, model_validator

from app.domain.taxonomy import TAXONOMY
from app.schemas.common import Schema


class RecognizedAttributes(Schema):
    category: str | None = Field(default=None, max_length=40)
    name: str | None = Field(default=None, max_length=100)
    color_codes: list[str] = Field(default_factory=list, max_length=20)
    seasons: list[str] = Field(default_factory=list, max_length=4)
    occasion_codes: list[str] = Field(default_factory=list, max_length=20)
    style_codes: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def vocabulary(self) -> Self:
        for field in ("category", "color_codes", "seasons", "occasion_codes", "style_codes"):
            value = getattr(self, field)
            values = value if isinstance(value, list) else [value] if value is not None else []
            if any(item not in TAXONOMY[field] for item in values):
                raise ValueError("unknown controlled value")
        return self


class RecognitionResult(Schema):
    attributes: RecognizedAttributes
    uncertainties: list[str] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def bounded_notes(self) -> Self:
        if any(len(note) > 200 for note in self.uncertainties):
            raise ValueError("uncertainty text too long")
        return self
