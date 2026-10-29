"""Explicit purchase planning; only distinct formal garments fulfill a plan."""

from typing import cast
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.inventory import InventoryDemand
from app.db.organization import SupplyLink, SupplyPlan, SupplySource
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.schemas.organization import (
    LinkedGarment,
    LinkInput,
    SourceView,
    SupplyInput,
    SupplyPage,
    SupplyStatus,
    SupplyView,
    VersionInput,
)
from app.services.operations import receipt, save_receipt
from app.services.wardrobe import find_garment


def source_view(row: InventoryDemand) -> SourceView:
    return SourceView(
        id=row.id,
        season=row.season,
        name=str(row.spec["name"]),
        active=row.deleted_at is None and bool(row.spec.get("enabled", True)),
    )


def view(db: Session, row: SupplyPlan) -> SupplyView:
    linked = [
        LinkedGarment(
            id=g.id,
            name=str(link.snapshot.get("name") or "未命名单品"),
            archived=g.deleted_at is not None or g.ownership != "owned",
        )
        for link, g in db.execute(
            select(SupplyLink, Garment)
            .join(Garment, SupplyLink.garment_id == Garment.id)
            .where(SupplyLink.plan_id == row.id)
            .order_by(SupplyLink.linked_at, Garment.id)
        )
    ]
    sources = [
        source_view(r)
        for r in db.scalars(
            select(InventoryDemand)
            .join(SupplySource, SupplySource.demand_id == InventoryDemand.id)
            .where(SupplySource.plan_id == row.id)
            .order_by(InventoryDemand.id)
        )
    ]
    return SupplyView(
        id=row.id,
        version=row.version,
        name=row.name,
        quantity=row.quantity,
        budget=row.budget,
        reason=row.reason,
        notes=row.notes,
        status=cast(SupplyStatus, row.status),
        cancelled_quantity=row.cancelled_quantity,
        remaining=row.quantity - len(linked) - row.cancelled_quantity,
        linked=linked,
        sources=sources,
    )


def find(db: Session, plan_id: UUID) -> SupplyPlan:
    row = db.scalar(select(SupplyPlan).where(SupplyPlan.id == plan_id).with_for_update())
    if not row:
        raise AppError("NOT_FOUND", "补充计划不存在", 404)
    return row


def check_version(row: SupplyPlan, expected: int) -> None:
    if row.version != expected:
        raise AppError("VERSION_CONFLICT", "计划已更新，请保留输入并读取最新内容")


def read(plan_id: UUID) -> SupplyView:
    with session_factory()() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        row = db.get(SupplyPlan, plan_id)
        if not row:
            raise AppError("NOT_FOUND", "补充计划不存在", 404)
        return view(db, row)


def listing(cursor: UUID | None, limit: int) -> SupplyPage:
    with session_factory()() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        query = select(SupplyPlan).order_by(SupplyPlan.id.desc()).limit(limit + 1)
        if cursor:
            query = query.where(SupplyPlan.id < cursor)
        rows = list(db.scalars(query))
        return SupplyPage(
            items=[view(db, r) for r in rows[:limit]],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
        )


def save(plan_id: UUID, payload: SupplyInput, key: str) -> SupplyView:
    with session_factory().begin() as db:
        op = f"supply:{plan_id}"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return SupplyView.model_validate(old.response)
        # Stable client-generated ID; creation and edits serialize on the same identity.
        from sqlalchemy import text

        db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:id, 0))"), {"id": op})
        row = db.get(SupplyPlan, plan_id)
        if row:
            row = find(db, plan_id)
            check_version(row, payload.expected_version)
        elif payload.expected_version:
            raise AppError("VERSION_CONFLICT", "计划不存在，请重新读取")
        else:
            row = SupplyPlan(id=plan_id, version=0, cancelled_quantity=0)
        if not payload.name.strip():
            raise AppError("VALIDATION_ERROR", "请填写计划名称", 422)
        links = list(db.scalars(select(SupplyLink).where(SupplyLink.plan_id == plan_id)))
        if payload.quantity < len(links):
            raise AppError("FULFILLED_QUANTITY", "计划数量不能少于已关联单品数", 422)
        old_sources = set(
            db.scalars(select(SupplySource.demand_id).where(SupplySource.plan_id == plan_id))
        )
        sources = list(
            db.scalars(
                select(InventoryDemand)
                .where(InventoryDemand.id.in_(payload.source_ids))
                .with_for_update(read=True)
            )
        )
        if len(sources) != len(set(payload.source_ids)) or any(
            not source_view(r).active and r.id not in old_sources for r in sources
        ):
            raise AppError("INVALID_SOURCE", "新增来源必须为仍启用的需求；旧来源可保留", 422)
        db.add(row)
        row.version += 1
        row.name, row.quantity = payload.name.strip(), payload.quantity
        row.budget = str(payload.budget) if payload.budget is not None else None
        row.reason, row.notes = payload.reason, payload.notes
        row.cancelled_quantity = 0
        row.status = "completed" if len(links) == row.quantity else payload.status
        db.flush()
        db.execute(
            delete(SupplySource).where(
                SupplySource.plan_id == plan_id, SupplySource.demand_id.not_in(payload.source_ids)
            )
        )
        for source in sources:
            if source.id not in old_sources:
                db.add(
                    SupplySource(
                        plan_id=plan_id,
                        demand_id=source.id,
                        snapshot={"season": source.season, **source.spec},
                    )
                )
        db.flush()
        result = view(db, row)
        save_receipt(db, op, key, digest, result.model_dump(mode="json"))
        return result


def link(plan_id: UUID, payload: LinkInput, key: str) -> SupplyView:
    with session_factory().begin() as db:
        op = f"supply-link:{plan_id}"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return SupplyView.model_validate(old.response)
        row = find(db, plan_id)
        check_version(row, payload.expected_version)
        g = find_garment(db, payload.garment_id, lock=True)
        existing = db.scalar(select(SupplyLink).where(SupplyLink.garment_id == g.id))
        if existing:
            raise AppError("ALREADY_LINKED", "该单品已核销过补充计划，不会重复计算")
        if g.version != payload.garment_version:
            raise AppError("VERSION_CONFLICT", "单品已更新，请重新选择")
        if g.is_demo or g.ownership != "owned":
            raise AppError("INVALID_GARMENT", "请选择正式入库且仍持有的真实单品", 422)
        current = view(db, row)
        if row.status not in {"planned", "purchased"} or current.remaining < 1:
            raise AppError("PLAN_CLOSED", "没有待核销数量，请先编辑计划")
        db.add(
            SupplyLink(
                plan_id=plan_id,
                garment_id=g.id,
                snapshot={"name": g.attributes.get("name"), "version": g.version},
            )
        )
        row.status = "completed" if current.remaining == 1 else "purchased"
        row.version += 1
        db.flush()
        result = view(db, row)
        save_receipt(db, op, key, digest, result.model_dump(mode="json"))
        return result


def cancel_remaining(plan_id: UUID, payload: VersionInput, key: str) -> SupplyView:
    with session_factory().begin() as db:
        op = f"supply-cancel:{plan_id}"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return SupplyView.model_validate(old.response)
        row = find(db, plan_id)
        check_version(row, payload.expected_version)
        current = view(db, row)
        if current.remaining == 0:
            raise AppError("PLAN_CLOSED", "此计划已无待核销数量")
        row.cancelled_quantity += current.remaining
        row.status = "completed" if current.linked else "cancelled"
        row.version += 1
        db.flush()
        result = view(db, row)
        save_receipt(db, op, key, digest, result.model_dump(mode="json"))
        return result
