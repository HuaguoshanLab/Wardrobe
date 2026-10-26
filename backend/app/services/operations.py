import hashlib
import json
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import SystemState
from app.db.wardrobe import OperationReceipt


def owner_id(db: Session) -> UUID:
    state = db.get(SystemState, 1)
    if state is None:
        raise AppError("NOT_INITIALIZED", "数据库未初始化", 503)
    return state.owner_id


def receipt(
    db: Session, operation: str, key: str, payload: object
) -> tuple[str, OperationReceipt | None]:
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    lock = int.from_bytes(hashlib.sha256(f"{operation}:{key}".encode()).digest()[:8], signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})
    old = db.scalar(
        select(OperationReceipt).where(
            OperationReceipt.operation == operation, OperationReceipt.key == key
        )
    )
    if old and old.request_hash != digest:
        raise AppError("IDEMPOTENCY_CONFLICT", "操作键已用于不同内容")
    return digest, old


def save_receipt(
    db: Session, operation: str, key: str, digest: str, response: dict[str, JsonValue]
) -> None:
    db.add(OperationReceipt(operation=operation, key=key, request_hash=digest, response=response))
