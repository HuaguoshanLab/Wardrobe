"""User plans and reason-specific decisions; references survive archive changes."""

from datetime import datetime
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base, utcnow


class SupplyPlan(Base):
    __tablename__ = "supply_plans"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    version: Mapped[int] = mapped_column(default=1)
    name: Mapped[str]
    quantity: Mapped[int]
    budget: Mapped[str | None]
    notes: Mapped[str] = mapped_column(default="")
    reason: Mapped[str] = mapped_column(default="")
    status: Mapped[str] = mapped_column(default="planned")
    cancelled_quantity: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SupplySource(Base):
    __tablename__ = "supply_sources"
    plan_id: Mapped[UUID] = mapped_column(ForeignKey("supply_plans.id"), primary_key=True)
    demand_id: Mapped[UUID] = mapped_column(ForeignKey("inventory_demands.id"), primary_key=True)
    snapshot: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)


class SupplyLink(Base):
    __tablename__ = "supply_links"
    __table_args__ = (UniqueConstraint("garment_id"),)
    plan_id: Mapped[UUID] = mapped_column(ForeignKey("supply_plans.id"), primary_key=True)
    garment_id: Mapped[UUID] = mapped_column(ForeignKey("garments.id"), primary_key=True)
    snapshot: Mapped[dict[str, JsonValue]] = mapped_column(JSONB)
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OrganizationDecision(Base):
    __tablename__ = "organization_decisions"
    __table_args__ = (UniqueConstraint("garment_id", "reason_key"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    garment_id: Mapped[UUID] = mapped_column(ForeignKey("garments.id"), index=True)
    reason_key: Mapped[str]
    reason: Mapped[str]
    state: Mapped[str]
    note: Mapped[str] = mapped_column(default="")
    version: Mapped[int] = mapped_column(default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
