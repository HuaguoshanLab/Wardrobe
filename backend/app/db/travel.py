from datetime import datetime
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base, utcnow


class TravelPlan(Base):
    __tablename__ = "travel_plans"
    __table_args__ = (Index("ix_travel_owner", "owner_id", "created_at"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID]
    version: Mapped[int] = mapped_column(default=1)
    draft: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    current_job_id: Mapped[UUID | None] = mapped_column(ForeignKey("jobs.id"))
    current_revision_id: Mapped[UUID | None]
    packed_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    added_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TravelRevision(Base):
    __tablename__ = "travel_revisions"
    __table_args__ = (UniqueConstraint("plan_id", "number"), UniqueConstraint("job_id"))
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    plan_id: Mapped[UUID] = mapped_column(ForeignKey("travel_plans.id"))
    job_id: Mapped[UUID] = mapped_column(ForeignKey("jobs.id"))
    number: Mapped[int]
    days: Mapped[list[dict[str, JsonValue]]] = mapped_column(JSONB)
    request: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    provider_mode: Mapped[str]
    warnings: Mapped[list[str]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
