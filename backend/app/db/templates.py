"""Reusable conditions, independent of sessions, weather and preferences."""

from datetime import datetime
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import DateTime, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base, utcnow


class ConditionTemplate(Base):
    __tablename__ = "condition_templates"
    __table_args__ = (Index("ix_condition_templates_owner", "owner_id", "deleted_at"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID]
    name: Mapped[str] = mapped_column(String(60))
    conditions: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
