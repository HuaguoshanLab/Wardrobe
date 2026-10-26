from datetime import UTC, datetime
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class SystemState(Base):
    __tablename__ = "system_state"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[UUID] = mapped_column(default=uuid4)
    data_epoch: Mapped[UUID] = mapped_column(default=uuid4)
    demo_seeded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("owner_id", "operation", "idempotency_key"),
        Index("ix_jobs_claim", "status", "created_at"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID]
    operation: Mapped[str] = mapped_column(String(100))
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(40), default="diagnostic")
    status: Mapped[str] = mapped_column(String(24), default="queued")
    input_snapshot: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    result: Mapped[dict[str, JsonValue] | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[dict[str, JsonValue] | None] = mapped_column(JSONB, nullable=True)
    provider_response: Mapped[dict[str, JsonValue] | None] = mapped_column(JSONB, nullable=True)
    call_state: Mapped[str] = mapped_column(String(24), default="not_started")
    retry_of_job_id: Mapped[UUID | None] = mapped_column(ForeignKey("jobs.id"))
    lease_token: Mapped[UUID | None]
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempt: Mapped[int] = mapped_column(default=0)
    last_seq: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class JobEvent(Base):
    __tablename__ = "job_events"
    job_id: Mapped[UUID] = mapped_column(ForeignKey("jobs.id"), primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(24))
    payload: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
