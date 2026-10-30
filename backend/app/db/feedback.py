from datetime import datetime
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base, utcnow


class WearFeedback(Base):
    __tablename__ = "wear_feedback"
    wear_record_id: Mapped[UUID] = mapped_column(
        ForeignKey("wear_records.id", ondelete="CASCADE"), primary_key=True
    )
    feedback: Mapped[dict[str, JsonValue] | None] = mapped_column(JSONB, nullable=True)
    version: Mapped[int] = mapped_column(default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
