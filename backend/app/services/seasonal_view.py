"""Read-only seasonal evidence; completed sessions never read live wardrobe facts."""

import hashlib
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.lifecycle import GarmentSubtype
from app.db.seasonal import SeasonalAction, SeasonalItem, SeasonalSession
from app.db.wardrobe import Garment, Tag
from app.schemas.inventory import InventoryView, Season
from app.schemas.seasonal import (
    ActionResult,
    SeasonalBrief,
    SeasonalItemView,
    SeasonalSummary,
    SeasonalView,
)
from app.schemas.wardrobe import Attributes, GarmentView
from app.services.inventory import snapshot_in
from app.services.wardrobe import garment_view


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def find(db: Session, sid: UUID, *, lock: bool = False) -> SeasonalSession:
    q = select(SeasonalSession).where(SeasonalSession.id == sid)
    row = db.scalar(q.with_for_update() if lock else q)
    if row is None:
        raise AppError("NOT_FOUND", "整理会话不存在", 404)
    return row


def active(row: SeasonalSession) -> None:
    if row.completed_at:
        raise AppError("SESSION_COMPLETED", "总结已保存，请创建新一轮整理")


def eligible(db: Session, row: SeasonalSession) -> list[Garment]:
    garments = db.scalars(
        select(Garment)
        .where(Garment.deleted_at.is_(None), Garment.ownership == "owned", ~Garment.is_demo)
        .order_by(Garment.id)
    )
    return [
        g
        for g in garments
        if (not row.categories or g.attributes.get("category") in row.categories)
        and (
            row.scope == "all"
            or not g.attributes.get("seasons")
            or row.season in Attributes.model_validate(g.attributes).seasons
        )
    ]


def target_token(db: Session, inv: InventoryView) -> str:
    return digest(
        {
            "plan": inv.plan.model_dump(mode="json"),
            "versions": inv.config_versions,
            "subtypes": [
                (str(s.id), s.version)
                for s in db.scalars(select(GarmentSubtype).order_by(GarmentSubtype.id))
            ],
            "tags": [(str(t.id), t.version) for t in db.scalars(select(Tag).order_by(Tag.id))],
        }
    )


def view(db: Session, row: SeasonalSession) -> SeasonalView:
    brief = SeasonalBrief.model_validate(row).model_dump()
    if row.summary is not None:
        summary = SeasonalSummary.model_validate(row.summary)
        return SeasonalView(
            **brief,
            items=summary.items,
            inventory=summary.inventory,
            actions=summary.actions,
            target_token="",
            targets_confirmed=True,
            preview_token="",
            preview=summary,
            summary=summary,
        )
    season: Season = SeasonalBrief.model_validate(row).season
    inv = snapshot_in(db, season)
    token = target_token(db, inv)
    items = []
    for item in db.scalars(
        select(SeasonalItem)
        .where(SeasonalItem.session_id == row.id)
        .order_by(SeasonalItem.garment_id)
    ):
        g = db.get(Garment, item.garment_id)
        current = garment_view(db, g) if g and not g.deleted_at else None
        items.append(
            SeasonalItemView(
                garment_id=item.garment_id,
                original=GarmentView.model_validate(item.snapshot),
                current=current,
                reviewed_version=item.reviewed_version,
                todo=item.todo,
                stale=bool(
                    current and item.reviewed_version and current.version != item.reviewed_version
                ),
            )
        )
    actions = [
        ActionResult.model_validate(a.result)
        for a in db.scalars(
            select(SeasonalAction)
            .where(SeasonalAction.session_id == row.id)
            .order_by(SeasonalAction.created_at, SeasonalAction.id)
        )
    ]
    unresolved = []
    for i in items:
        name = i.original.name or "未命名单品"
        if i.current is None:
            unresolved.append(f"{name}：已删除，保留原始记录")
        elif i.stale:
            unresolved.append(f"{name}：核对结果过期")
        elif i.reviewed_version is None:
            unresolved.append(f"{name}：尚未核对")
        if i.todo:
            unresolved.append(f"{name}：{i.todo}")
    latest = {a.garment_id: a for a in actions}
    for gid, action in latest.items():
        if not action.success:
            name = next(i.original.name or "未命名单品" for i in items if i.garment_id == gid)
            unresolved.append(f"{name}：上次动作未执行（{action.message}）")
    ids = {i.garment_id for i in items}
    outside = sum(g.id not in ids for g in eligible(db, row))
    if outside:
        unresolved.append(f"范围建立后新增 {outside} 件符合范围的单品，未纳入本轮")
    summary = SeasonalSummary(
        stats_at=inv.stats_at,
        rules_token=token,
        inventory=inv,
        items=items,
        actions=actions,
        reviewed=sum(
            i.current is not None and i.reviewed_version is not None and not i.stale for i in items
        ),
        total=len(items),
        unresolved=unresolved,
        outside_scope=outside,
    )
    evidence = summary.model_dump(
        mode="json", exclude={"stats_at": True, "inventory": {"stats_at"}}
    )
    return SeasonalView(
        **brief,
        items=items,
        inventory=inv,
        actions=actions,
        target_token=token,
        targets_confirmed=token == row.target_token,
        preview_token=digest({"summary": evidence, "version": row.version, "targets": token}),
        preview=summary,
        summary=None,
    )
