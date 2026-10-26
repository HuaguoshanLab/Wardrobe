from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Job
from app.db.outfits import OutfitMessage, OutfitRevision, OutfitSession
from app.db.session import session_factory
from app.db.wardrobe import Garment, Tag
from app.schemas.jobs import TERMINAL
from app.schemas.outfits import (
    MessageList,
    MessageView,
    RevisionView,
    SessionCreate,
    SessionPatch,
    SessionView,
)
from app.schemas.profile import Requirements
from app.services.operations import owner_id, receipt, save_receipt
from app.services.profile import profile


def get_session(db: Session, session_id: UUID, *, lock: bool = False) -> OutfitSession:
    stmt = select(OutfitSession).where(OutfitSession.id == session_id)
    if lock:
        stmt = stmt.with_for_update()
    row = db.scalar(stmt)
    if row is None:
        raise AppError("NOT_FOUND", "搭配会话不存在", 404)
    return row


def get_revision(db: Session, revision_id: UUID) -> OutfitRevision:
    row = db.get(OutfitRevision, revision_id)
    if row is None:
        raise AppError("NOT_FOUND", "搭配版本不存在", 404)
    return row


def check_idle(db: Session, row: OutfitSession, version: int) -> None:
    if row.current_job_id:
        job = db.get(Job, row.current_job_id)
        if job and job.status not in TERMINAL:
            raise AppError("SESSION_BUSY", f"请等待当前任务结束：{job.id}")
    if row.version != version:
        raise AppError("VERSION_CONFLICT", "会话已更新，请重新载入后操作")


def check_tags(db: Session, requirements: Requirements) -> None:
    ids = set(requirements.custom_tag_ids)
    if ids != set(db.scalars(select(Tag.id).where(Tag.id.in_(ids)))):
        raise AppError("TAG_NOT_FOUND", "条件中的标签已删除，请修改条件", 422)


def invalid_ids(db: Session, ids: list[str]) -> list[UUID]:
    valid = set(
        db.scalars(
            select(Garment.id).where(
                Garment.id.in_([UUID(i) for i in ids]),
                Garment.deleted_at.is_(None),
                Garment.attributes["availability"].astext == "available",
                Garment.is_demo.is_(False),
            )
        )
    )
    return [UUID(i) for i in ids if UUID(i) not in valid]


def garment_ids(revision: OutfitRevision) -> list[str]:
    return [str(i["garment_id"]) for i in revision.items if i["source"] == "wardrobe"]


def session_view(db: Session, row: OutfitSession) -> SessionView:
    revisions = [get_revision(db, UUID(i)) for i in row.latest_revision_ids]
    if row.selected_revision_id and str(row.selected_revision_id) not in row.latest_revision_ids:
        revisions.append(get_revision(db, row.selected_revision_id))
    messages = list(
        db.scalars(
            select(OutfitMessage)
            .where(OutfitMessage.session_id == row.id)
            .order_by(OutfitMessage.created_at.desc(), OutfitMessage.id.desc())
            .limit(30)
        )
    )
    return SessionView(
        id=row.id,
        version=row.version,
        requirements=Requirements.model_validate(row.requirements),
        selected_revision_id=row.selected_revision_id,
        locked_garment_ids=[UUID(i) for i in row.locked_garment_ids],
        current_job_id=row.current_job_id,
        latest_revision_ids=[UUID(i) for i in row.latest_revision_ids],
        revisions=[RevisionView.model_validate(r) for r in revisions],
        messages=[MessageView.model_validate(m) for m in reversed(messages)],
        invalid_garment_ids=list(
            set(invalid_ids(db, [i for r in revisions for i in garment_ids(r)]))
        ),
    )


def read_session(session_id: UUID | None = None) -> SessionView | None:
    with session_factory().begin() as db:
        current = session_id or profile(db).current_session_id
        return session_view(db, get_session(db, current)) if current else None


def create_session(payload: SessionCreate, key: str) -> SessionView:
    with session_factory().begin() as db:
        digest, old = receipt(db, "outfit-session", key, payload.model_dump(mode="json"))
        if old:
            return SessionView.model_validate(old.response)
        pref = profile(db, lock=True)
        check_tags(db, payload.requirements)
        base = get_revision(db, payload.base_revision_id) if payload.base_revision_id else None
        requirements = (
            base.request_snapshot["requirements"]
            if base
            else payload.requirements.model_dump(mode="json")
        )
        row = OutfitSession(
            owner_id=owner_id(db),
            requirements=requirements,
            selected_revision_id=base.id if base else None,
            latest_revision_ids=[str(base.id)] if base else [],
        )
        db.add(row)
        db.flush()
        pref.current_session_id = row.id
        result = session_view(db, row)
        save_receipt(db, "outfit-session", key, digest, result.model_dump(mode="json"))
        return result


def patch_session(session_id: UUID, payload: SessionPatch, key: str) -> SessionView:
    with session_factory().begin() as db:
        operation = f"outfit-session:{session_id}"
        digest, old = receipt(
            db, operation, key, payload.model_dump(mode="json", exclude_unset=True)
        )
        if old:
            return SessionView.model_validate(old.response)
        row = get_session(db, session_id, lock=True)
        check_idle(db, row, payload.expected_version)
        removed: list[UUID] = []
        if "selected_revision_id" in payload.model_fields_set:
            if (
                payload.selected_revision_id
                and str(payload.selected_revision_id) not in row.latest_revision_ids
            ):
                raise AppError("INVALID_SELECTION", "只能选择本会话候选方案", 422)
            row.selected_revision_id = payload.selected_revision_id
            valid = (
                garment_ids(get_revision(db, row.selected_revision_id))
                if row.selected_revision_id
                else []
            )
            invalid = invalid_ids(db, valid)
            removed = [
                UUID(i) for i in row.locked_garment_ids if i not in valid or UUID(i) in invalid
            ]
            row.locked_garment_ids = [i for i in row.locked_garment_ids if UUID(i) not in removed]
        if payload.requirements is not None:
            check_tags(db, payload.requirements)
            row.requirements = payload.requirements.model_dump(mode="json")
        if payload.locked_garment_ids is not None:
            allowed = (
                garment_ids(get_revision(db, row.selected_revision_id))
                if row.selected_revision_id
                else []
            )
            locks = list(dict.fromkeys(map(str, payload.locked_garment_ids)))
            if not set(locks) <= set(allowed) or invalid_ids(db, locks):
                raise AppError("CONSTRAINT_CONFLICT", "锁定必须属于选中方案且当前可穿")
            row.locked_garment_ids = locks
        row.version += 1
        result = session_view(db, row)
        result.removed_lock_ids = removed
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result


def messages(session_id: UUID, limit: int, cursor: UUID | None) -> MessageList:
    with session_factory()() as db:
        get_session(db, session_id)
        query = select(OutfitMessage).where(OutfitMessage.session_id == session_id)
        if cursor:
            previous = db.get(OutfitMessage, cursor)
            if previous is None or previous.session_id != session_id:
                raise AppError("INVALID_CURSOR", "消息游标无效", 422)
            query = query.where(
                or_(
                    OutfitMessage.created_at < previous.created_at,
                    (OutfitMessage.created_at == previous.created_at) & (OutfitMessage.id < cursor),
                )
            )
        rows = list(
            db.scalars(
                query.order_by(OutfitMessage.created_at.desc(), OutfitMessage.id.desc()).limit(
                    limit + 1
                )
            )
        )
        return MessageList(
            items=[MessageView.model_validate(m) for m in rows[:limit]],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
        )
