from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.collections import WearRecord
from app.db.feedback import WearFeedback
from app.db.models import utcnow
from app.db.session import session_factory
from app.schemas.collections import WearView
from app.schemas.feedback import FeedbackData, FeedbackPatch, FeedbackView
from app.services.collections.records import view as wear_view
from app.services.operations import receipt, save_receipt
from app.services.outfits.sessions import get_revision


def record(db: Session, record_id: UUID, *, lock: bool = False) -> WearRecord:
    row = db.get(WearRecord, record_id, with_for_update=lock)
    if row is None:
        raise AppError("NOT_FOUND", "穿着记录不存在或已删除", 404)
    return row


def view(record_id: UUID, row: WearFeedback | None) -> FeedbackView:
    return FeedbackView(
        wear_record_id=record_id,
        version=row.version if row else 0,
        feedback=FeedbackData.model_validate(row.feedback) if row and row.feedback else None,
        updated_at=row.updated_at if row else None,
    )


def get_record(record_id: UUID) -> WearView:
    with session_factory()() as db:
        return WearView.model_validate(wear_view(db, record(db, record_id)))


def get(record_id: UUID) -> FeedbackView:
    with session_factory()() as db:
        record(db, record_id)
        return view(record_id, db.get(WearFeedback, record_id))


def save(record_id: UUID, payload: FeedbackPatch | None, version: int, key: str) -> FeedbackView:
    operation = f"wear-feedback:{record_id}:{'save' if payload else 'delete'}"
    with session_factory().begin() as db:
        digest, old = receipt(
            db, operation, key, payload.model_dump(mode="json") if payload else {"version": version}
        )
        if old:
            return FeedbackView.model_validate(old.response)
        wear = record(db, record_id, lock=True)
        row = db.get(WearFeedback, record_id)
        if version != (row.version if row else 0):
            raise AppError("VERSION_CONFLICT", "反馈已在其他页面更新，请保留输入并读取最新版本")
        if payload and payload.feedback.garment_id:
            revision = get_revision(db, wear.revision_id)
            ids = {str(item["garment_id"]) for item in revision.items if item.get("garment_id")}
            if str(payload.feedback.garment_id) not in ids:
                raise AppError("FEEDBACK_TARGET_INVALID", "只能反馈这条穿着记录快照中的单品", 422)
        if row is None:
            row = WearFeedback(wear_record_id=record_id, version=0)
            db.add(row)
        row.feedback = payload.feedback.model_dump(mode="json") if payload else None
        row.version += 1
        row.updated_at = utcnow()
        db.flush()
        result = view(record_id, row)
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result
