"""Optional, human-confirmed initial wardrobe facts; no lifecycle actions."""

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import Schema
from app.schemas.lifecycle import actual_date


class ImportDetails(Schema):
    subtype_name: str | None = Field(default=None, max_length=40)
    source: Literal["purchased", "gift", "other"] | None = None
    acquired_on: date | None = None
    price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    location: str | None = Field(default=None, max_length=120)
    condition: Literal["unknown", "good", "worn", "needs_repair", "damaged"] = "unknown"
    fit: Literal["unknown", "fits", "unfit", "not_applicable"] = "unknown"
    storage: Literal["daily", "stored"] = "daily"
    notes: str = Field(default="", max_length=2000)

    @field_validator("price")
    @classmethod
    def canonical_price(cls, value: Decimal | None) -> Decimal | None:
        if value is None:
            return None
        # Validation above rejects excess nonzero decimals; this never rounds invalid input.
        return (abs(value) if value == 0 else value).quantize(Decimal("0.01"))

    @field_validator("subtype_name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator("acquired_on")
    @classmethod
    def past_date(cls, value: date | None) -> date | None:
        return actual_date(value) if value else None
