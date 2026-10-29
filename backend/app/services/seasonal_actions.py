"""Explicit, bounded batches with savepoints and durable per-item outcomes."""

from uuid import UUID

from app.core.errors import AppError
from app.db.seasonal import SeasonalAction, SeasonalItem
from app.db.session import session_factory
from app.schemas.seasonal import ActionResult, BatchInput, BatchResult
from app.services.lifecycle import apply_in
from app.services.operations import receipt, save_receipt
from app.services.organization_process import lock_inventory
from app.services.seasonal_view import active, find
from app.services.wardrobe import find_garment


def execute(sid: UUID, payload: BatchInput, key: str) -> BatchResult:
    with session_factory().begin() as db:
        op = f"seasonal-actions:{sid}"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return BatchResult.model_validate(old.response)
        lock_inventory(db)
        row = find(db, sid, lock=True)
        active(row)
        for value in payload.items:
            if db.get(SeasonalItem, (sid, value.garment_id)) is None:
                raise AppError("OUTSIDE_SCOPE", "单品不在本轮范围", 422)
        results = []
        for value in payload.items:
            previous = db.get(SeasonalAction, value.id)
            body = value.model_dump(mode="json")
            if previous:
                if previous.session_id != sid or previous.payload != body:
                    raise AppError("IDEMPOTENCY_CONFLICT", "单项操作 ID 已用于不同内容")
                results.append(ActionResult.model_validate(previous.result))
                continue
            try:
                with db.begin_nested():
                    item = db.get(SeasonalItem, (sid, value.garment_id))
                    if item is None:
                        raise AppError("OUTSIDE_SCOPE", "单品不在本轮范围", 422)
                    g = find_garment(db, value.garment_id)
                    if g.is_demo or g.ownership != "owned":
                        raise AppError("GARMENT_RETIRED", "单品已退出，不能再次处理")
                    was_reviewed = item.reviewed_version == g.version
                    garment = apply_in(db, g.id, value.operation, f"seasonal:{value.id}")
                    # A free-text task can contain work unrelated to this action.
                    # Only an explicit review update may clear it.
                    if was_reviewed:
                        item.reviewed_version = garment.version
                    result = ActionResult(**body, success=True, message="已执行", garment=garment)
                    db.flush()
            except AppError as exc:
                result = ActionResult(**body, success=False, message=exc.message)
            db.add(
                SeasonalAction(
                    id=value.id,
                    session_id=sid,
                    garment_id=value.garment_id,
                    payload=body,
                    result=result.model_dump(mode="json"),
                )
            )
            db.flush()
            results.append(result)
        row.version += 1
        result_batch = BatchResult(items=results)
        save_receipt(db, op, key, digest, result_batch.model_dump(mode="json"))
        return result_batch
