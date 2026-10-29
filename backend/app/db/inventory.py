"""Versioned seasonal plans; soft-deleted demand IDs remain available for future references."""

from datetime import datetime
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class InventoryPlan(Base):
    __tablename__ = "inventory_plans"
    season: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(default=1)
    city: Mapped[str] = mapped_column(default="")
    period: Mapped[str] = mapped_column(default="")
    notes: Mapped[str] = mapped_column(default="")


class InventoryDemand(Base):
    __tablename__ = "inventory_demands"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    season: Mapped[str] = mapped_column(ForeignKey("inventory_plans.season"), index=True)
    position: Mapped[int]
    spec: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
