"""Durable seasonal progress and immutable item/action snapshots."""

from datetime import datetime
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base, utcnow


class SeasonalSession(Base):
    __tablename__ = "seasonal_sessions"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    season: Mapped[str]
    scope: Mapped[str]
    categories: Mapped[list[str]] = mapped_column(JSONB)
    version: Mapped[int] = mapped_column(default=1)
    stage: Mapped[str] = mapped_column(default="review")
    target_token: Mapped[str | None]
    summary: Mapped[dict[str, JsonValue] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SeasonalItem(Base):
    __tablename__ = "seasonal_items"
    session_id: Mapped[UUID] = mapped_column(ForeignKey("seasonal_sessions.id"), primary_key=True)
    garment_id: Mapped[UUID] = mapped_column(ForeignKey("garments.id"), primary_key=True)
    snapshot: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    reviewed_version: Mapped[int | None]
    todo: Mapped[str] = mapped_column(default="")


class SeasonalAction(Base):
    __tablename__ = "seasonal_actions"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("seasonal_sessions.id"), index=True)
    garment_id: Mapped[UUID] = mapped_column(ForeignKey("garments.id"))
    payload: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    result: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
