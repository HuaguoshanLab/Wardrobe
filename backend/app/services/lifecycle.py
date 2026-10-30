from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.lifecycle import GarmentSubtype, LifecycleEvent
from app.db.session import session_factory
from app.domain.taxonomy import TAXONOMY
from app.schemas.lifecycle import (
    EventView,
    LifecycleHistory,
    LifecycleInput,
    LifecycleProfile,
    SubtypeInput,
    SubtypeView,
)
from app.schemas.wardrobe import GarmentView
from app.services.garment_state import check_subtype, record, state
from app.services.operations import receipt, save_receipt
from app.services.wardrobe import find_garment, garment_view
from app.services.wear_stats import wear_rollup

FIELDS = {
    "profile": {"source", "acquired_on", "price", "location", "notes", "subtype_id"},
    "condition": {"condition", "fit"},
    "storage": {"storage", "location"},
    "availability": {"availability", "unavailable_reason"},
    "repair_start": set(),
    "repair_complete": {"condition", "availability", "unavailable_reason"},
    "decision": {"decision", "decision_reason"},
    "retire": {"exit_reason"},
    "restore": {"availability", "unavailable_reason"},
    "correct": set(),
}


def apply(garment_id: UUID, payload: LifecycleInput, key: str) -> GarmentView:
    with session_factory().begin() as db:
        return apply_in(db, garment_id, payload, key)


def apply_in(
    db: Session,
    garment_id: UUID,
    payload: LifecycleInput,
    key: str,
    *,
    sync_decisions: bool = True,
    impact_checked: bool = False,
) -> GarmentView:
    operation = f"lifecycle:{garment_id}"
    digest, old = receipt(db, operation, key, payload.model_dump(mode="json"))
    if old:
        return GarmentView.model_validate(old.response)
    if payload.action == "retire" and not impact_checked:
        from app.services.organization_process import lock_inventory

        lock_inventory(db)
    garment = find_garment(db, garment_id, lock=True)
    if garment.version != payload.expected_version:
        raise AppError("VERSION_CONFLICT", "单品已更新，请保留草稿并读取最新版本")
    changes = dict(payload.changes)
    action = payload.action
    if changes.keys() - FIELDS[action]:
        raise AppError("INVALID_ACTION", "此动作包含不允许修改的字段", 422)
    if payload.related_event_id and action not in {"correct", "restore"}:
        raise AppError("INVALID_ACTION", "此动作不能关联更正事件", 422)
    related = db.get(LifecycleEvent, payload.related_event_id) if payload.related_event_id else None
    if action in {"correct", "restore"}:
        if not related or related.garment_id != garment.id or not payload.reason.strip():
            raise AppError("INVALID_EVENT", "请选择此单品的原记录并填写更正原因", 422)
    if action == "correct" and related and related.action == "correct":
        raise AppError("INVALID_EVENT", "请关联原始记录，而非另一条更正", 422)
    if garment.ownership == "retired" and action not in {"restore", "correct", "profile"}:
        raise AppError("GARMENT_RETIRED", "单品已退出，误操作请先撤销退出")
    if action == "retire" and not impact_checked:
        from app.services.organization_process import impact

        if not payload.impact_token or impact(db, garment_id).token != payload.impact_token:
            raise AppError("IMPACT_CHANGED", "衣橱或目标已变化，请重新读取退出影响并确认")
    before = state(garment)
    profile = dict(garment.lifecycle)
    availability = garment.attributes.get("availability", "available")
    if "subtype_id" in changes:
        previous_subtype = garment.subtype_id
        raw_id = changes.pop("subtype_id")
        try:
            garment.subtype_id = UUID(str(raw_id)) if raw_id else None
        except ValueError as exc:
            raise AppError("INVALID_SUBTYPE", "子类 ID 无效", 422) from exc
        check_subtype(
            db,
            garment.subtype_id,
            garment.attributes.get("category"),
            retained=garment.subtype_id == previous_subtype,
        )
    if "availability" in changes:
        availability = changes.pop("availability")
    if availability not in ("available", "unavailable"):
        raise AppError("INVALID_AVAILABILITY", "请选择可穿或暂不可用", 422)
    if action == "repair_start":
        availability = "unavailable"
        changes.update(condition="needs_repair", unavailable_reason="repair")
    if action == "repair_complete":
        if profile.get("unavailable_reason") != "repair":
            raise AppError("INVALID_ACTION", "当前没有正在进行的维修")
        if not {"condition", "availability"} <= payload.changes.keys():
            raise AppError("INVALID_ACTION", "完成维修需重新确认状况和可用性", 422)
        if (
            changes.get("condition") in ("needs_repair", "unknown")
            or changes.get("unavailable_reason") == "repair"
        ):
            raise AppError("INVALID_ACTION", "请确认维修后的状况和不可用原因", 422)
        profile["unavailable_reason"] = None
    if action == "retire":
        if not changes.get("exit_reason"):
            raise AppError("INVALID_ACTION", "退出需选择去向", 422)
        garment.ownership = "retired"
        changes["exited_on"] = payload.occurred_on.isoformat()
    if action == "restore":
        latest = db.scalar(
            select(LifecycleEvent)
            .where(LifecycleEvent.garment_id == garment.id, LifecycleEvent.action == "retire")
            .order_by(LifecycleEvent.version.desc())
            .limit(1)
        )
        if garment.ownership != "retired" or not related or related != latest:
            raise AppError("INVALID_ACTION", "只能撤销当前最后一次退出")
        if "availability" not in payload.changes:
            raise AppError("INVALID_ACTION", "撤销退出需重新确认可用性", 422)
        garment.ownership = "owned"
        changes.update(exit_reason=None, exited_on=None)
    if action == "decision" and changes.get("decision") != profile.get("decision"):
        profile["decision_reason"] = ""
    if (
        action == "restore"
        and profile.get("exited_on")
        and payload.occurred_on.isoformat() < str(profile["exited_on"])
    ):
        raise AppError("INVALID_DATE", "撤销日期不能早于退出日期", 422)
    profile.update(changes)
    if availability == "available":
        profile["unavailable_reason"] = None
    try:
        validated = LifecycleProfile.model_validate(profile)
    except ValidationError as exc:
        raise AppError(
            "VALIDATION_ERROR", "生命周期资料格式无效，请检查金额、日期和选项", 422
        ) from exc
    if (
        validated.acquired_on
        and validated.exited_on
        and validated.exited_on < validated.acquired_on
    ):
        raise AppError("INVALID_DATE", "退出日期不能早于获得日期", 422)
    garment.lifecycle = validated.model_dump(mode="json")
    garment.attributes = {**garment.attributes, "availability": availability}
    garment.version += 1
    record(
        db,
        garment,
        action,
        before,
        payload.occurred_on,
        payload.reason,
        payload.related_event_id,
    )
    db.flush()
    if sync_decisions and action in {
        "decision",
        "repair_start",
        "repair_complete",
        "retire",
        "restore",
    }:
        from app.services.organization_decisions import sync_lifecycle

        sync_lifecycle(db, garment, action)
    result = garment_view(db, garment)
    save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
    return result


def history(garment_id: UUID, cursor: int | None, limit: int) -> LifecycleHistory:
    with session_factory()() as db:
        find_garment(db, garment_id)
        query = select(LifecycleEvent).where(LifecycleEvent.garment_id == garment_id)
        if cursor:
            query = query.where(LifecycleEvent.version < cursor)
        rows = list(db.scalars(query.order_by(LifecycleEvent.version.desc()).limit(limit + 1)))
        stats = wear_rollup(garment_id=garment_id)
        worn = db.execute(
            select(stats.c.wear_days, stats.c.first_worn_on, stats.c.last_worn_on)
        ).one_or_none()
        last_exit = db.scalar(
            select(LifecycleEvent.id)
            .where(LifecycleEvent.garment_id == garment_id, LifecycleEvent.action == "retire")
            .order_by(LifecycleEvent.version.desc())
            .limit(1)
        )
        return LifecycleHistory(
            last_exit_event_id=last_exit,
            items=[EventView.model_validate(r) for r in rows[:limit]],
            next_cursor=rows[limit - 1].version if len(rows) > limit else None,
            wear_days=worn[0] if worn else 0,
            first_worn_on=worn[1] if worn else None,
            last_worn_on=worn[2] if worn else None,
        )


def create_subtype(payload: SubtypeInput, key: str) -> SubtypeView:
    from sqlalchemy.dialects.postgresql import insert

    with session_factory().begin() as db:
        digest, old = receipt(db, "subtype", key, payload.model_dump(mode="json"))
        if old:
            return SubtypeView.model_validate(old.response)
        name = payload.name.strip()
        if payload.category not in TAXONOMY["category"] or not name:
            raise AppError("INVALID_SUBTYPE", "请选择品类并填写子类名称", 422)
        db.execute(
            insert(GarmentSubtype)
            .values(category=payload.category, name=name)
            .on_conflict_do_nothing()
        )
        row = db.scalar(
            select(GarmentSubtype).where(
                GarmentSubtype.category == payload.category, GarmentSubtype.name == name
            )
        )
        result = SubtypeView.model_validate(row)
        if not result.active:
            raise AppError("INACTIVE_SUBTYPE", "同名子类已停用，请在子类管理中重新启用")
        save_receipt(db, "subtype", key, digest, result.model_dump(mode="json"))
        return result
