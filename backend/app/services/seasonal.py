"""Session creation, explicit progress and immutable completion."""

from uuid import UUID

from sqlalchemy import select

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.seasonal import SeasonalItem, SeasonalSession
from app.db.session import session_factory
from app.domain.taxonomy import TAXONOMY
from app.schemas.seasonal import (
    CompleteInput,
    ProgressInput,
    SeasonalBrief,
    SeasonalCreate,
    SeasonalPage,
    SeasonalView,
)
from app.services.operations import receipt, save_receipt
from app.services.organization_process import lock_inventory
from app.services.seasonal_view import active, eligible, find, view
from app.services.wardrobe import find_garment, garment_view


def listing(cursor: UUID | None, limit: int) -> SeasonalPage:
    with session_factory()() as db:
        q = select(SeasonalSession).order_by(SeasonalSession.id.desc())
        if cursor:
            q = q.where(SeasonalSession.id < cursor)
        rows = list(db.scalars(q.limit(limit + 1)))
        return SeasonalPage(
            items=[SeasonalBrief.model_validate(r) for r in rows[:limit]],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
        )


def read(sid: UUID) -> SeasonalView:
    with session_factory()() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        return view(db, find(db, sid))


def create(payload: SeasonalCreate, key: str) -> SeasonalView:
    with session_factory().begin() as db:
        op = "seasonal-create"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return SeasonalView.model_validate(old.response)
        lock_inventory(db)
        if db.get(SeasonalSession, payload.id):
            raise AppError("SESSION_EXISTS", "此会话已创建，请打开已有进度")
        if set(payload.categories) - set(TAXONOMY["category"]):
            raise AppError("INVALID_CATEGORY", "范围包含无效品类", 422)
        row = SeasonalSession(**payload.model_dump())
        db.add(row)
        db.flush()
        for g in eligible(db, row):
            db.add(
                SeasonalItem(
                    session_id=row.id,
                    garment_id=g.id,
                    snapshot=garment_view(db, g).model_dump(mode="json"),
                )
            )
        db.flush()
        result = view(db, row)
        save_receipt(db, op, key, digest, result.model_dump(mode="json"))
        return result


def progress(sid: UUID, payload: ProgressInput, key: str) -> SeasonalView:
    with session_factory().begin() as db:
        op = f"seasonal-progress:{sid}"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return SeasonalView.model_validate(old.response)
        lock_inventory(db)
        row = find(db, sid, lock=True)
        active(row)
        if row.version != payload.expected_version:
            raise AppError("VERSION_CONFLICT", "整理进度已变化，请读取最新状态")
        if payload.target_token and view(db, row).target_token != payload.target_token:
            raise AppError("TARGET_CHANGED", "目标或规则已变化，请重新核对")
        for value in payload.items:
            item = db.get(SeasonalItem, (sid, value.garment_id))
            if item is None:
                raise AppError("OUTSIDE_SCOPE", "单品不在本轮范围", 422)
            g = find_garment(db, value.garment_id)
            if g.version != value.garment_version:
                raise AppError("VERSION_CONFLICT", "单品已变化，请重新核对")
            item.reviewed_version = g.version if value.reviewed else None
            item.todo = value.todo.strip()
        row.stage, row.version = payload.stage, row.version + 1
        if payload.target_token:
            row.target_token = payload.target_token
        db.flush()
        result = view(db, row)
        save_receipt(db, op, key, digest, result.model_dump(mode="json"))
        return result


def complete(sid: UUID, payload: CompleteInput, key: str) -> SeasonalView:
    with session_factory().begin() as db:
        op = f"seasonal-complete:{sid}"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return SeasonalView.model_validate(old.response)
        lock_inventory(db)
        row = find(db, sid, lock=True)
        active(row)
        current = view(db, row)
        if (
            row.version != payload.expected_version
            or current.preview_token != payload.preview_token
        ):
            raise AppError("PREVIEW_CHANGED", "整理依据已变化，请读取最新总结后确认")
        if not current.targets_confirmed or any(i.stale for i in current.items):
            raise AppError("REVIEW_REQUIRED", "请先核对已变化的单品及当前目标")
        if current.preview.unresolved and not payload.acknowledge_unresolved:
            raise AppError("UNRESOLVED", "请明确确认保留未解决项")
        row.summary = current.preview.model_dump(mode="json")
        row.stage, row.completed_at, row.version = "summary", utcnow(), row.version + 1
        db.flush()
        result = view(db, row)
        save_receipt(db, op, key, digest, result.model_dump(mode="json"))
        return result
