from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base, utcnow


class Favorite(Base):
    __tablename__ = "favorites"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    revision_id: Mapped[UUID] = mapped_column(ForeignKey("outfit_revisions.id"), unique=True)
    name: Mapped[str] = mapped_column(default="")
    version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WearRecord(Base):
    __tablename__ = "wear_records"
    __table_args__ = (UniqueConstraint("revision_id", "worn_on"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    revision_id: Mapped[UUID] = mapped_column(ForeignKey("outfit_revisions.id"))
    worn_on: Mapped[date]
    timezone: Mapped[str] = mapped_column(default="Asia/Shanghai")
    notes: Mapped[str] = mapped_column(default="")
    version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
