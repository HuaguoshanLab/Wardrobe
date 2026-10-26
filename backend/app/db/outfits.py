from datetime import datetime
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base, utcnow


class OutfitSession(Base):
    __tablename__ = "outfit_sessions"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID]
    version: Mapped[int] = mapped_column(default=1)
    requirements: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    selected_revision_id: Mapped[UUID | None]
    locked_garment_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    current_job_id: Mapped[UUID | None] = mapped_column(ForeignKey("jobs.id"))
    latest_revision_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OutfitRevision(Base):
    __tablename__ = "outfit_revisions"
    __table_args__ = (UniqueConstraint("run_id", "position"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("outfit_sessions.id"))
    hidden_from_history_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    history_version: Mapped[int] = mapped_column(default=1, server_default="1")
    parent_revision_id: Mapped[UUID | None] = mapped_column(ForeignKey("outfit_revisions.id"))
    run_id: Mapped[UUID] = mapped_column(ForeignKey("jobs.id"))
    position: Mapped[int]
    items: Mapped[list[dict[str, JsonValue]]] = mapped_column(JSONB)
    reason: Mapped[str]
    unmet_requirements: Mapped[list[str]] = mapped_column(JSONB)
    weather_snapshot: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    request_snapshot: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    provider_mode: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OutfitMessage(Base):
    __tablename__ = "outfit_messages"
    __table_args__ = (UniqueConstraint("job_id", "role"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("outfit_sessions.id"))
    role: Mapped[str]
    content: Mapped[str]
    job_id: Mapped[UUID | None] = mapped_column(ForeignKey("jobs.id"))
    revision_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OutfitImage(Base):
    __tablename__ = "outfit_images"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    media_asset_id: Mapped[UUID] = mapped_column(ForeignKey("media_assets.id"))
    storage_key: Mapped[str]


class ModelCall(Base):
    __tablename__ = "outfit_model_calls"
    job_id: Mapped[UUID] = mapped_column(ForeignKey("jobs.id"), primary_key=True)
    step: Mapped[str] = mapped_column(primary_key=True)
    attempt: Mapped[int] = mapped_column(primary_key=True)
    state: Mapped[str]
    response: Mapped[dict[str, JsonValue] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
