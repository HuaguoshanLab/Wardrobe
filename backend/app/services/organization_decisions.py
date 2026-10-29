"""Reason-specific human decisions. A new problem never silently overwrites keep."""

from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.organization import OrganizationDecision
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.schemas.lifecycle import LifecycleInput
from app.schemas.organization import DecisionInput
from app.schemas.wardrobe import GarmentView
from app.services.lifecycle import apply_in
from app.services.operations import receipt, save_receipt
from app.services.organization_context import context
from app.services.wardrobe import find_garment, garment_view


def sync_lifecycle(db: Session, garment: Garment, action: str) -> None:
    """Keep W3 decisions aligned with explicit W1 actions, never with reads."""
    existing = list(
        db.scalars(
            select(OrganizationDecision).where(OrganizationDecision.garment_id == garment.id)
        )
    )
    if action != "decision":
        for decision in existing:
            target = {"repair_start": "repair", "retire": "done"}.get(action)
            if (action == "repair_complete" and decision.state == "repair") or (
                action == "restore" and decision.state == "done"
            ):
                target = "observe"
            if target and target != decision.state:
                decision.state = target
                decision.version += 1
                decision.updated_at = utcnow()
        return
    if garment.lifecycle.get("decision") != "keep":
        for r in existing:
            if r.state == "keep" or (
                garment.lifecycle.get("decision") == "undecided" and r.state == "pending"
            ):
                r.state, r.version, r.updated_at = "undecided", r.version + 1, utcnow()
        return
    reasons = context(db).reasons
    known = {r.reason_key: r for r in existing}
    for (gid, key), reason in reasons.items():
        if gid != garment.id:
            continue
        row = known.get(key)
        if row is None:
            row = OrganizationDecision(garment_id=gid, reason_key=key, version=0)
            db.add(row)
        row.state, row.reason = "keep", reason
        row.note = str(garment.lifecycle.get("decision_reason") or "")
        row.version += 1
        row.updated_at = utcnow()


def decide(garment_id: UUID, payload: DecisionInput, key: str) -> GarmentView:
    with session_factory().begin() as db:
        op = f"organization-decision:{garment_id}"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return GarmentView.model_validate(old.response)
        g = find_garment(db, garment_id, lock=True)
        if g.version != payload.garment_version:
            raise AppError("VERSION_CONFLICT", "单品已更新，请重新核对")
        if g.is_demo or g.ownership != "owned":
            raise AppError("INVALID_GARMENT", "请选择仍持有的正式单品", 422)
        row = db.scalar(
            select(OrganizationDecision)
            .where(
                OrganizationDecision.garment_id == garment_id,
                OrganizationDecision.reason_key == payload.reason_key,
            )
            .with_for_update()
        )
        if (row.version if row else 0) != payload.expected_version:
            raise AppError("VERSION_CONFLICT", "此原因的决定已更新，请保留输入并重新读取")
        reason = context(db).reasons.get((g.id, payload.reason_key))
        if payload.reason_key == "manual":
            reason = "用户主动整理"
        if not reason and row is None:
            raise AppError("REASON_CHANGED", "此建议依据已变化，请刷新后重新评估")
        if payload.state in {"keep", "pending"} and not payload.note.strip():
            raise AppError("REASON_REQUIRED", "请记录保留或待处理的原因", 422)
        previous = row.state if row else None
        if row is None:
            row = OrganizationDecision(garment_id=g.id, reason_key=payload.reason_key, version=0)
            db.add(row)
        row.state, row.reason = payload.state, reason or row.reason
        row.note, row.version, row.updated_at = payload.note, row.version + 1, utcnow()
        db.flush()
        remaining = db.scalar(
            select(OrganizationDecision)
            .where(
                OrganizationDecision.garment_id == g.id,
                OrganizationDecision.state.in_(["keep", "pending"]),
                OrganizationDecision.id != row.id,
            )
            .order_by(OrganizationDecision.updated_at.desc(), OrganizationDecision.id)
            .limit(1)
        )
        decision: str | None = None
        decision_note = ""
        if payload.state in {"keep", "pending"}:
            decision, decision_note = payload.state, payload.note
        elif previous in {"keep", "pending"}:
            # Removing one reason must not erase another explicit decision, or
            # leave a pending state with no remaining reason in the W1 profile.
            decision = remaining.state if remaining else "undecided"
            decision_note = remaining.note if remaining else ""
        if decision:
            apply_in(
                db,
                g.id,
                LifecycleInput(
                    expected_version=g.version,
                    action="decision",
                    occurred_on=datetime.now(ZoneInfo("Asia/Shanghai")).date(),
                    reason=payload.note,
                    changes={"decision": decision, "decision_reason": decision_note},
                ),
                f"organization:{key}",
                sync_decisions=False,
            )
        result = garment_view(db, g)
        save_receipt(db, op, key, digest, result.model_dump(mode="json"))
        return result
