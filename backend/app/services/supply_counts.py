"""Planned quantities remain separate from inventory, including shared sources."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.organization import SupplyLink, SupplyPlan, SupplySource


def planned_counts(db: Session) -> dict[UUID, int]:
    linked = (
        select(SupplyLink.plan_id, func.count().label("count"))
        .group_by(SupplyLink.plan_id)
        .subquery()
    )
    query = (
        select(SupplySource.demand_id, SupplyPlan.quantity, func.coalesce(linked.c.count, 0))
        .join(SupplyPlan, SupplySource.plan_id == SupplyPlan.id)
        .outerjoin(linked, linked.c.plan_id == SupplyPlan.id)
        .where(SupplyPlan.status.in_(["planned", "purchased"]))
    )
    counts: dict[UUID, int] = {}
    for demand_id, quantity, fulfilled in db.execute(query):
        counts[demand_id] = counts.get(demand_id, 0) + quantity - fulfilled
    return counts
