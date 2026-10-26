from datetime import date
from uuid import UUID

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.collections import Favorite, WearRecord
from app.db.session import session_factory
from app.schemas.collections import (
    Deleted,
    FavoriteCreate,
    FavoriteList,
    FavoritePatch,
    FavoriteView,
    WearCreate,
    WearList,
    WearPatch,
    WearView,
)
from app.schemas.outfits import RevisionView
from app.services.operations import receipt, save_receipt
from app.services.outfits.sessions import get_revision


def view(db: Session, row: Favorite | WearRecord) -> FavoriteView | WearView:
    revision = RevisionView.model_validate(get_revision(db, row.revision_id))
    common = dict(
        id=row.id,
        revision_id=row.revision_id,
        version=row.version,
        created_at=row.created_at,
        revision=revision,
    )
    if isinstance(row, Favorite):
        return FavoriteView.model_validate({**common, "name": row.name})
    return WearView.model_validate(
        {**common, "worn_on": row.worn_on, "timezone": row.timezone, "notes": row.notes}
    )


def favorites(limit: int, cursor: UUID | None) -> FavoriteList:
    with session_factory()() as db:
        query = select(Favorite)
        if cursor:
            previous = db.get(Favorite, cursor)
            if not previous:
                raise AppError("INVALID_CURSOR", "收藏游标无效", 422)
            query = query.where(
                or_(
                    Favorite.created_at < previous.created_at,
                    (Favorite.created_at == previous.created_at) & (Favorite.id < cursor),
                )
            )
        rows = list(
            db.scalars(
                query.order_by(Favorite.created_at.desc(), Favorite.id.desc()).limit(limit + 1)
            )
        )
        return FavoriteList(
            items=[FavoriteView.model_validate(view(db, r)) for r in rows[:limit]],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
        )


def wears(limit: int, cursor: UUID | None, start: date | None, end: date | None) -> WearList:
    if start and end and start > end:
        raise AppError("INVALID_DATE_RANGE", "起始日期不能晚于结束日期", 422)
    with session_factory()() as db:
        query = select(WearRecord)
        if start:
            query = query.where(WearRecord.worn_on >= start)
        if end:
            query = query.where(WearRecord.worn_on <= end)
        if cursor:
            previous = db.get(WearRecord, cursor)
            if not previous:
                raise AppError("INVALID_CURSOR", "穿着记录游标无效", 422)
            query = query.where(
                or_(
                    WearRecord.created_at < previous.created_at,
                    (WearRecord.created_at == previous.created_at) & (WearRecord.id < cursor),
                )
            )
        rows = list(
            db.scalars(
                query.order_by(WearRecord.created_at.desc(), WearRecord.id.desc()).limit(limit + 1)
            )
        )
        return WearList(
            items=[WearView.model_validate(view(db, r)) for r in rows[:limit]],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
        )


def create(payload: FavoriteCreate | WearCreate, key: str) -> FavoriteView | WearView:
    favorite = isinstance(payload, FavoriteCreate)
    operation = "favorite-create" if favorite else "wear-create"
    schema = FavoriteView if favorite else WearView
    with session_factory().begin() as db:
        digest, old = receipt(db, operation, key, payload.model_dump(mode="json"))
        if old:
            return schema.model_validate(old.response)
        db.execute(text("SELECT pg_advisory_xact_lock(51002)"))
        get_revision(db, payload.revision_id)
        row: Favorite | WearRecord | None
        if isinstance(payload, FavoriteCreate):
            row = db.scalar(select(Favorite).where(Favorite.revision_id == payload.revision_id))
            if row is None:
                row = Favorite(revision_id=payload.revision_id, name=payload.name.strip())
        else:
            row = db.scalar(
                select(WearRecord).where(
                    WearRecord.revision_id == payload.revision_id,
                    WearRecord.worn_on == payload.worn_on,
                )
            )
            if row is None:
                row = WearRecord(
                    revision_id=payload.revision_id,
                    worn_on=payload.worn_on,
                    notes=payload.notes.strip(),
                )
        db.add(row)
        db.flush()
        result = view(db, row)
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result


def change(
    record_id: UUID,
    payload: FavoritePatch | WearPatch | None,
    version: int,
    key: str,
    favorite: bool,
) -> FavoriteView | WearView | Deleted:
    operation = (
        f"{'favorite' if favorite else 'wear'}:{record_id}:{'patch' if payload else 'delete'}"
    )
    with session_factory().begin() as db:
        digest, old = receipt(
            db, operation, key, payload.model_dump(mode="json") if payload else {"version": version}
        )
        if old:
            schema = (FavoriteView if favorite else WearView) if payload else Deleted
            return schema.model_validate(old.response)
        db.execute(text("SELECT pg_advisory_xact_lock(51002)"))
        row: Favorite | WearRecord | None = (
            db.get(Favorite, record_id, with_for_update=True)
            if favorite
            else db.get(WearRecord, record_id, with_for_update=True)
        )
        if row is None:
            raise AppError("NOT_FOUND", "记录不存在", 404)
        if row.version != version:
            raise AppError("VERSION_CONFLICT", "记录已更新，请重新载入")
        result: FavoriteView | WearView | Deleted
        if payload is None:
            db.delete(row)
            result = Deleted(id=record_id, message="记录已删除，搭配快照仍保留。")
        else:
            if isinstance(row, Favorite) and isinstance(payload, FavoritePatch):
                row.name = payload.name.strip()
            elif isinstance(row, WearRecord) and isinstance(payload, WearPatch):
                other = db.scalar(
                    select(WearRecord).where(
                        WearRecord.revision_id == row.revision_id,
                        WearRecord.worn_on == payload.worn_on,
                        WearRecord.id != row.id,
                    )
                )
                if other:
                    raise AppError("WEAR_EXISTS", "该日期已记录此搭配，请编辑已有记录")
                row.worn_on, row.notes = payload.worn_on, payload.notes.strip()
            row.version += 1
            result = view(db, row)
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result
