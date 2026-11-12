from datetime import datetime
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base, utcnow


class Reference(Base):
    __tablename__ = "outfit_references"
    __table_args__ = (Index("ix_reference_owner", "owner_id", "created_at"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID]
    version: Mapped[int] = mapped_column(default=1)
    original_key: Mapped[str]
    display_key: Mapped[str]
    analysis: Mapped[dict[str, JsonValue] | None] = mapped_column(JSONB, nullable=True)
    clues: Mapped[list[dict[str, JsonValue]]] = mapped_column(JSONB, default=list)
    confirmed: Mapped[bool] = mapped_column(default=False)
    current_job_id: Mapped[UUID | None] = mapped_column(ForeignKey("jobs.id"))
    revision_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    provider_mode: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
