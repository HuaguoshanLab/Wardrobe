"""Daily care batches: existing wardrobe facts, durable receipts, per-item savepoints."""

from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.session import session_factory
from app.db.wardrobe import Tag
from app.schemas.care import CareBatch, CareItem, CareOutcome, CareResult
from app.schemas.lifecycle import LifecycleInput
from app.schemas.wardrobe import Attributes, GarmentList, GarmentView
from app.services.catalog import list_garments
from app.services.lifecycle import apply_in
from app.services.operations import receipt, save_receipt
from app.services.organization_process import lock_inventory
from app.services.wardrobe import find_garment, garment_view, patch_garment_in


def listing(
    group: Literal["washing", "available", "all"],
    q: str,
    category: str | None,
    cursor: UUID | None,
    limit: int,
) -> GarmentList:
    return list_garments(
        limit,
        cursor,
        q,
        category,
        None,
        None,
        "unavailable" if group == "washing" else "available" if group == "available" else None,
        None,
        unavailable_reason="washing" if group == "washing" else None,
        exclude_demo=True,
    )


def change(db: Session, item: CareItem) -> tuple[GarmentView, bool]:
    g = find_garment(db, item.garment_id, lock=True)
    if g.ownership != "owned" or g.is_demo:
        raise AppError("INVALID_GARMENT", "单品已退出或属于示例，不能批量处理")
    if g.version != item.expected_version:
        raise AppError("VERSION_CONFLICT", "单品已更新，请重新核对后确认")
    available = g.attributes.get("availability", "available")
    reason = g.lifecycle.get("unavailable_reason")
    action = item.action
    if action in {"tags_add", "tags_remove"}:
        tags = set(db.scalars(select(Tag.id).where(Tag.id.in_(item.tag_ids))))
        if tags != set(item.tag_ids):
            raise AppError("TAG_NOT_FOUND", "所选标签已删除，请重新选择", 422)
        existing = [str(t) for t in Attributes.model_validate(g.attributes).custom_tag_ids]
        requested = [str(t) for t in item.tag_ids]
        updated = (
            list(dict.fromkeys([*existing, *requested]))
            if action == "tags_add"
            else [t for t in existing if t not in requested]
        )
        if len(updated) > 30:
            raise AppError("TAG_LIMIT", "添加后超过 30 个标签，请减少所选标签", 422)
        if existing == updated:
            return garment_view(db, g), False
        return patch_garment_in(db, g.id, g.version, {"custom_tag_ids": updated}), True
    changes: dict[str, JsonValue]
    if action == "mark_washing":
        if available == "unavailable":
            if reason == "washing":
                return garment_view(db, g), False
            raise AppError("STATE_CONFLICT", "当前因维修或其他原因不可穿，请逐件处理状态")
        changes = {"availability": "unavailable", "unavailable_reason": "washing"}
    elif action == "wash_done":
        if available != "unavailable" or reason != "washing":
            raise AppError("STATE_CONFLICT", "当前已不是待洗状态，未恢复可穿，请逐件核对")
        changes = {"availability": "available", "unavailable_reason": None}
    else:
        target = item.location if action == "location_set" else None
        if g.lifecycle.get("location") == target:
            return garment_view(db, g), False
        changes = {"location": target}
    result = apply_in(
        db,
        g.id,
        LifecycleInput(
            expected_version=g.version,
            action="profile" if action.startswith("location_") else "availability",
            occurred_on=utcnow().astimezone(ZoneInfo("Asia/Shanghai")).date(),
            changes=changes,
            reason="日常批量操作",
        ),
        f"care:{item.id}",
    )
    return result, True


def execute(payload: CareBatch, key: str) -> CareResult:
    with session_factory().begin() as db:
        digest, previous = receipt(db, "wardrobe-care", key, payload.model_dump(mode="json"))
        if previous:
            return CareResult.model_validate(previous.response)
        lock_inventory(db)
        results = []
        for item in payload.items:
            body = item.model_dump(mode="json")
            item_digest, old = receipt(db, "wardrobe-care-item", str(item.id), body)
            if old:
                results.append(CareOutcome.model_validate(old.response))
                continue
            try:
                with db.begin_nested():
                    garment, changed = change(db, item)
                    result = CareOutcome(
                        id=item.id,
                        garment_id=item.garment_id,
                        success=True,
                        changed=changed,
                        code="UPDATED" if changed else "UNCHANGED",
                        message="已完成" if changed else "已是目标状态，无需修改",
                        garment=garment,
                    )
                    db.flush()
            except AppError as exc:
                result = CareOutcome(
                    id=item.id,
                    garment_id=item.garment_id,
                    success=False,
                    code=exc.code,
                    message=exc.message,
                )
            save_receipt(
                db, "wardrobe-care-item", str(item.id), item_digest, result.model_dump(mode="json")
            )
            db.flush()
            results.append(result)
        response = CareResult(items=results)
        save_receipt(db, "wardrobe-care", key, digest, response.model_dump(mode="json"))
        return response
