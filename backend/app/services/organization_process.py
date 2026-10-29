"""Impact preview and atomic lifecycle actions with fresh inventory evidence."""

from hashlib import sha256
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.organization import OrganizationDecision
from app.db.session import session_factory
from app.domain.inventory import conclusion
from app.schemas.lifecycle import LifecycleInput
from app.schemas.organization import ExitImpact, ExitImpactRow, ProcessInput, SourceView
from app.schemas.wardrobe import GarmentView
from app.services.lifecycle import apply_in
from app.services.operations import receipt, save_receipt
from app.services.organization_context import context
from app.services.wardrobe import find_garment


def impact(db: Session, garment_id: UUID) -> ExitImpact:
    g = find_garment(db, garment_id)
    if g.is_demo or g.ownership != "owned":
        raise AppError("INVALID_GARMENT", "单品已退出或属于示例，不能执行整理退出", 422)
    ctx = context(db)
    rows, invalid = [], []
    for view in ctx.views:
        specs = {r.id: r for r in view.plan.rows}
        for c in view.counts:
            r = specs[c.row_id]
            if not r.enabled:
                continue
            source = SourceView(id=r.id, name=r.name, season=view.plan.season, active=True)
            if c.rule_errors:
                if r.category == g.attributes.get("category"):
                    invalid.append(source)
                continue
            member = next((m for m in c.members if m.garment_id == garment_id), None)
            if not member or member.bucket == "excluded":
                continue
            k = c.confirmed - int(member.bucket == "confirmed")
            u = c.pending - int(member.bucket == "pending")
            status, difference = conclusion(r.lower, r.upper, k, u)
            rows.append(
                ExitImpactRow(
                    source=source,
                    lower=r.lower,
                    upper=r.upper,
                    before_confirmed=c.confirmed,
                    after_confirmed=k,
                    before_pending=c.pending,
                    after_pending=u,
                    conclusion=status,
                    difference=difference,
                )
            )
    # Includes rules, versions, every garment's version and all per-row facts.
    # Timestamp is deliberately excluded so a pure reread does not invalidate it.
    evidence = "|".join(
        v.model_dump_json(exclude={"stats_at": True, "counts": {"__all__": {"planned"}}})
        for v in ctx.views
    )
    token = sha256(evidence.encode()).hexdigest()
    return ExitImpact(
        garment_id=g.id, garment_version=g.version, token=token, rows=rows, invalid_sources=invalid
    )


def read_impact(garment_id: UUID) -> ExitImpact:
    with session_factory()() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        return impact(db, garment_id)


def process(garment_id: UUID, payload: ProcessInput, key: str) -> GarmentView:
    with session_factory().begin() as db:
        op = f"organization-process:{garment_id}"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return GarmentView.model_validate(old.response)
        # Short, explicit table lock: also blocks inserts/phantoms and changes to
        # shared rows in other seasons. Never held during network/model calls.
        lock_inventory(db)
        g = find_garment(db, garment_id, lock=True)
        if g.version != payload.garment_version:
            raise AppError("VERSION_CONFLICT", "单品已变化，请重新核对处理依据")
        if g.is_demo or g.ownership != "owned":
            raise AppError("INVALID_GARMENT", "请选择仍持有的正式单品", 422)
        if payload.action != "repair":
            if not payload.impact_token or impact(db, garment_id).token != payload.impact_token:
                raise AppError("IMPACT_CHANGED", "衣橱或目标已变化，请重新读取退出影响并确认")
        result = apply_in(
            db,
            garment_id,
            LifecycleInput(
                expected_version=g.version,
                action="repair_start" if payload.action == "repair" else "retire",
                occurred_on=payload.occurred_on,
                reason=payload.reason,
                changes={} if payload.action == "repair" else {"exit_reason": payload.action},
            ),
            f"organization:{key}",
            sync_decisions=False,
            impact_checked=True,
        )
        decisions = list(
            db.scalars(
                select(OrganizationDecision).where(OrganizationDecision.garment_id == garment_id)
            )
        )
        if not decisions:
            decisions = [
                OrganizationDecision(
                    garment_id=g.id, reason_key="manual", reason="用户主动整理", version=0
                )
            ]
            db.add(decisions[0])
        for row in decisions:
            row.state = "repair" if payload.action == "repair" else "done"
            row.note, row.version, row.updated_at = payload.reason, row.version + 1, utcnow()
        save_receipt(db, op, key, digest, result.model_dump(mode="json"))
        return result


def lock_inventory(db: Session) -> None:
    db.execute(
        text(
            "LOCK TABLE garments, inventory_plans, inventory_demands, garment_subtypes, tags "
            "IN EXCLUSIVE MODE"
        )
    )
