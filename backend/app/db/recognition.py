from datetime import datetime
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base, utcnow


class RecognitionCall(Base):
    __tablename__ = "recognition_calls"
    job_id: Mapped[UUID] = mapped_column(ForeignKey("jobs.id"), primary_key=True)
    row_id: Mapped[UUID] = mapped_column(ForeignKey("import_rows.id"), primary_key=True)
    state: Mapped[str]
    config: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    response: Mapped[dict[str, JsonValue] | None] = mapped_column(JSONB, nullable=True)
    error_code: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
