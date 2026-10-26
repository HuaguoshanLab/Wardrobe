from uuid import UUID

from sqlalchemy import or_, select, text

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.outfits import OutfitRevision, OutfitSession
from app.db.session import session_factory
from app.schemas.collections import Deleted, HistoryEntry, HistoryList
from app.schemas.outfits import RevisionView
from app.services.operations import receipt, save_receipt
from app.services.outfits.sessions import check_idle, get_revision


def history(limit: int, cursor: UUID | None) -> HistoryList:
    with session_factory()() as db:
        query = select(OutfitRevision).where(OutfitRevision.hidden_from_history_at.is_(None))
        if cursor:
            previous = get_revision(db, cursor)
            query = query.where(
                or_(
                    OutfitRevision.created_at < previous.created_at,
                    (OutfitRevision.created_at == previous.created_at)
                    & (OutfitRevision.id < cursor),
                )
            )
        rows = list(
            db.scalars(
                query.order_by(OutfitRevision.created_at.desc(), OutfitRevision.id.desc()).limit(
                    limit + 1
                )
            )
        )
        return HistoryList(
            items=[
                HistoryEntry(
                    revision=RevisionView.model_validate(r),
                    version=r.history_version,
                    hidden_from_history_at=r.hidden_from_history_at,
                )
                for r in rows[:limit]
            ],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
        )


def hide(revision_id: UUID, version: int, key: str) -> Deleted:
    with session_factory().begin() as db:
        operation = f"history-hide:{revision_id}"
        digest, old = receipt(db, operation, key, {"version": version})
        if old:
            return Deleted.model_validate(old.response)
        # Serialize against explicit reuse, which may create a new referencing session.
        db.execute(text("SELECT pg_advisory_xact_lock(51001)"))
        sessions = list(
            db.scalars(
                select(OutfitSession)
                .where(
                    or_(
                        OutfitSession.selected_revision_id == revision_id,
                        OutfitSession.latest_revision_ids.contains([str(revision_id)]),
                    )
                )
                .order_by(OutfitSession.id)
                .with_for_update()
            )
        )
        for session in sessions:
            check_idle(db, session, session.version)
        revision = db.scalar(
            select(OutfitRevision).where(OutfitRevision.id == revision_id).with_for_update()
        )
        if revision is None:
            raise AppError("NOT_FOUND", "搭配版本不存在", 404)
        if revision.history_version != version:
            raise AppError("VERSION_CONFLICT", "历史状态已更新，请重新载入")
        revision.hidden_from_history_at = utcnow()
        revision.history_version += 1
        for session in sessions:
            session.latest_revision_ids = [
                i for i in session.latest_revision_ids if i != str(revision_id)
            ]
            if session.selected_revision_id == revision_id:
                session.selected_revision_id = None
                session.locked_garment_ids = []
            session.version += 1
        result = Deleted(
            id=revision_id, message="已从历史隐藏并清除相关选择；收藏、穿着记录及图片保留。"
        )
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result
