"""Explicit manual composition; no Job, model request, or current-session side effect."""

from uuid import uuid4

from sqlalchemy import select

from app.core.errors import AppError
from app.db.collections import WearRecord
from app.db.outfits import OutfitRevision
from app.db.session import session_factory
from app.db.wardrobe import Garment, Tag
from app.schemas.collections import WearView
from app.schemas.manual_outfits import ManualOutfitInput, ManualOutfitResult
from app.schemas.outfits import RevisionView
from app.schemas.profile import Requirements
from app.services.operations import owner_id, receipt, save_receipt
from app.services.outfits.sessions import get_revision
from app.services.outfits.snapshots import snapshot


def create(payload: ManualOutfitInput, key: str) -> ManualOutfitResult:
    with session_factory().begin() as db:
        digest, old = receipt(db, "manual-outfit", key, payload.model_dump(mode="json"))
        if old:
            return ManualOutfitResult.model_validate(old.response)
        if payload.parent_revision_id:
            parent = get_revision(db, payload.parent_revision_id)
            if parent.source != "manual":
                raise AppError("INVALID_PARENT", "只能从手动搭配创建新的手动版本", 422)
        requested = {i.garment_id: i.expected_version for i in payload.items}
        garments = list(
            db.scalars(
                select(Garment)
                .where(Garment.id.in_(requested))
                .order_by(Garment.id)
                .with_for_update()
            )
        )
        owner = owner_id(db)
        if len(garments) != len(requested) or any(
            g.owner_id != owner or g.deleted_at is not None or g.is_demo or g.ownership != "owned"
            for g in garments
        ):
            raise AppError("CONSTRAINT_CONFLICT", "所选单品已删除、退出或不是正式衣橱单品")
        if any(g.version != requested[g.id] for g in garments):
            raise AppError("VERSION_CONFLICT", "所选衣服已更新，请读取最新信息后重新核对")
        unavailable = {g.id for g in garments if g.attributes.get("availability") != "available"}
        if unavailable and payload.mode == "save":
            raise AppError("CONSTRAINT_CONFLICT", "保存可复用搭配需选择当前可穿的衣服")
        if set(payload.acknowledged_unavailable_ids) != unavailable:
            raise AppError("WEAR_CONFIRMATION_REQUIRED", "请核对暂不可用单品并确认当日确实穿过")
        tags = {str(t.id): t.name for t in db.scalars(select(Tag))}
        by_id = {g.id: g for g in garments}
        items = [snapshot(db, by_id[i.garment_id], tags) for i in payload.items]
        revision = OutfitRevision(
            id=uuid4(),
            source="manual",
            session_id=None,
            run_id=None,
            provider_mode=None,
            position=0,
            parent_revision_id=payload.parent_revision_id,
            items=[i.model_dump(mode="json") for i in items],
            reason="由你手动选择单品保存。图片和属性为保存时快照，未经过 AI 推荐。",
            unmet_requirements=[],
            weather_snapshot={},
            request_snapshot={
                "requirements": Requirements().model_dump(mode="json"),
                "manual_mode": payload.mode,
                "acknowledged_unavailable_ids": list(map(str, unavailable)),
            },
        )
        db.add(revision)
        db.flush()
        view = RevisionView.model_validate(revision)
        wear = None
        if payload.mode == "wear":
            record = WearRecord(
                revision_id=revision.id, worn_on=payload.worn_on, notes=payload.notes.strip()
            )
            db.add(record)
            db.flush()
            wear = WearView(
                id=record.id,
                revision_id=revision.id,
                worn_on=record.worn_on,
                timezone=record.timezone,
                notes=record.notes,
                version=record.version,
                created_at=record.created_at,
                revision=view,
            )
        result = ManualOutfitResult(revision=view, wear=wear)
        save_receipt(db, "manual-outfit", key, digest, result.model_dump(mode="json"))
        return result
