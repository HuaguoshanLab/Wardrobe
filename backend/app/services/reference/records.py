import hashlib
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Job, utcnow
from app.db.reference import Reference
from app.db.session import session_factory
from app.media.images import normalize
from app.media.storage import path_for, remove_keys, store_bytes
from app.schemas.jobs import TERMINAL
from app.schemas.reference import ReferenceConfirm, ReferenceVersion, ReferenceView
from app.services.operations import owner_id, receipt, save_receipt


def require(db: Session, ref_id: UUID, lock: bool = False) -> Reference:
    query = select(Reference).where(
        Reference.id == ref_id, Reference.owner_id == owner_id(db), Reference.deleted_at.is_(None)
    )
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise AppError("REFERENCE_NOT_FOUND", "参考记录不存在或已删除", 404)
    return row


def check(db: Session, row: Reference, version: int) -> None:
    if row.version != version:
        raise AppError("VERSION_CONFLICT", "参考记录已变化，请保留输入并读取最新版本")
    job = db.get(Job, row.current_job_id) if row.current_job_id else None
    if job and job.status not in TERMINAL:
        raise AppError("REFERENCE_BUSY", "任务正在进行，请等待或取消后再操作")


def view(row: Reference) -> ReferenceView:
    return ReferenceView.model_validate(
        {
            "id": row.id,
            "version": row.version,
            "image_url": f"/api/v1/references/{row.id}/image",
            "analysis": row.analysis,
            "clues": row.clues,
            "confirmed": row.confirmed,
            "current_job_id": row.current_job_id,
            "revision_ids": row.revision_ids,
            "provider_mode": row.provider_mode,
            "created_at": row.created_at,
        }
    )


def upload(data: bytes, key: str) -> ReferenceView:
    display, _, _ = normalize(data)
    stored: list[str] = []
    try:
        with session_factory().begin() as db:
            digest, old = receipt(
                db, "reference-upload", key, {"sha256": hashlib.sha256(data).hexdigest()}
            )
            if old:
                return ReferenceView.model_validate(old.response)
            original_key, _ = store_bytes(data, "reference-original")
            stored.append(original_key)
            display_key, _ = store_bytes(display, "reference-display")
            stored.append(display_key)
            row = Reference(
                owner_id=owner_id(db), original_key=original_key, display_key=display_key
            )
            db.add(row)
            db.flush()
            result = view(row)
            save_receipt(db, "reference-upload", key, digest, result.model_dump(mode="json"))
        stored.clear()
        return result
    finally:
        remove_keys(stored)


def listing(offset: int) -> list[ReferenceView]:
    with session_factory()() as db:
        return [
            view(r)
            for r in db.scalars(
                select(Reference)
                .where(Reference.owner_id == owner_id(db), Reference.deleted_at.is_(None))
                .order_by(Reference.created_at.desc(), Reference.id)
                .offset(offset)
                .limit(20)
            )
        ]


def get(ref_id: UUID) -> ReferenceView:
    with session_factory()() as db:
        return view(require(db, ref_id))


def image_bytes(ref_id: UUID) -> bytes:
    with session_factory()() as db:
        return path_for(require(db, ref_id).display_key).read_bytes()


def mutate(
    ref_id: UUID, payload: ReferenceVersion, key: str, delete: bool = False
) -> ReferenceView:
    with session_factory().begin() as db:
        op = f"reference-{'delete' if delete else 'confirm'}:{ref_id}"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return ReferenceView.model_validate(old.response)
        row = require(db, ref_id, True)
        check(db, row, payload.expected_version)
        if delete:
            row.deleted_at = utcnow()
        else:
            if row.analysis is None or not isinstance(payload, ReferenceConfirm):
                raise AppError("ANALYSIS_REQUIRED", "请先完成分析，再确认参考线索", 422)
            row.clues = [c.model_dump(mode="json") for c in payload.clues]
            row.confirmed = True
        row.version += 1
        result = view(row)
        save_receipt(db, op, key, digest, result.model_dump(mode="json"))
        return result
