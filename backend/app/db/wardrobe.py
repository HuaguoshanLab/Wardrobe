from datetime import datetime
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base, utcnow


class MediaAsset(Base):
    __tablename__ = "media_assets"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID]
    original_key: Mapped[str]
    original_name: Mapped[str]
    sha256: Mapped[str] = mapped_column(String(64))
    display_key: Mapped[str | None]
    cutout_key: Mapped[str | None]
    width: Mapped[int | None]
    height: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Tag(Base):
    __tablename__ = "tags"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID]
    name: Mapped[str] = mapped_column(String(40))
    normalized_name: Mapped[str] = mapped_column(String(40), unique=True)
    version: Mapped[int] = mapped_column(default=1)


class Garment(Base):
    __tablename__ = "garments"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID]
    image_asset_id: Mapped[UUID] = mapped_column(ForeignKey("media_assets.id"))
    attributes: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    is_demo: Mapped[bool] = mapped_column(default=False)
    version: Mapped[int] = mapped_column(default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID]
    source: Mapped[str] = mapped_column(String(16))
    parent_job_id: Mapped[UUID] = mapped_column(ForeignKey("jobs.id"))
    source_key: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ImportRow(Base):
    __tablename__ = "import_rows"
    __table_args__ = (UniqueConstraint("batch_id", "row_number"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    batch_id: Mapped[UUID] = mapped_column(ForeignKey("import_batches.id"))
    row_number: Mapped[int]
    filename: Mapped[str]
    image_asset_id: Mapped[UUID | None] = mapped_column(ForeignKey("media_assets.id"))
    draft: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    touched_fields: Mapped[list[str]] = mapped_column(JSONB, default=list)
    step_jobs: Mapped[dict[str, JsonValue]] = mapped_column(JSONB, default=dict)
    errors: Mapped[dict[str, JsonValue]] = mapped_column(JSONB, default=dict)
    version: Mapped[int] = mapped_column(default=1)
    skipped: Mapped[bool] = mapped_column(default=False)
    conversion_status: Mapped[str] = mapped_column(default="queued")
    analysis_status: Mapped[str] = mapped_column(default="not_requested")
    cutout_status: Mapped[str] = mapped_column(default="queued")
    analysis_source: Mapped[str | None]
    confirmed_garment_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("garments.id"), unique=True
    )


class OperationReceipt(Base):
    __tablename__ = "operation_receipts"
    __table_args__ = (UniqueConstraint("operation", "key"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    operation: Mapped[str] = mapped_column(String(120))
    key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
