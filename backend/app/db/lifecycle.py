"""Stable garment subtypes and append-only lifecycle history."""

from datetime import date, datetime
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base, utcnow


class GarmentSubtype(Base):
    __tablename__ = "garment_subtypes"
    __table_args__ = (UniqueConstraint("category", "name"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    category: Mapped[str]
    name: Mapped[str]
    active: Mapped[bool] = mapped_column(default=True, server_default="true")
    version: Mapped[int] = mapped_column(default=1, server_default="1")


class LifecycleEvent(Base):
    __tablename__ = "garment_events"
    __table_args__ = (UniqueConstraint("garment_id", "version"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    garment_id: Mapped[UUID] = mapped_column(ForeignKey("garments.id"), index=True)
    action: Mapped[str]
    occurred_on: Mapped[date]
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    reason: Mapped[str]
    version: Mapped[int]
    related_event_id: Mapped[UUID | None] = mapped_column(ForeignKey("garment_events.id"))
    before: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    after: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
