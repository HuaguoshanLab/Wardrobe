"""Shared wardrobe eligibility and lifecycle audit primitives."""

from datetime import date
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import ColumnElement, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.lifecycle import GarmentSubtype, LifecycleEvent
from app.db.wardrobe import Garment
from app.schemas.lifecycle import LifecycleProfile


def eligible_filter() -> tuple[ColumnElement[bool], ...]:
    return (
        Garment.deleted_at.is_(None),
        Garment.is_demo.is_(False),
        Garment.ownership == "owned",
        Garment.attributes["availability"].astext == "available",
    )


def eligible(garment: Garment) -> bool:
    return (
        not garment.deleted_at
        and not garment.is_demo
        and garment.ownership == "owned"
        and garment.attributes.get("availability") == "available"
    )


def check_subtype(
    db: Session, subtype_id: UUID | None, category: object, *, retained: bool = False
) -> None:
    if subtype_id:
        subtype = db.scalar(
            select(GarmentSubtype).where(GarmentSubtype.id == subtype_id).with_for_update(read=True)
        )
        if subtype is None or subtype.category != category:
            raise AppError("INVALID_SUBTYPE", "子类不属于此品类，请先清除或重新选择子类", 422)
        if not subtype.active and not retained:
            raise AppError("INACTIVE_SUBTYPE", "子类已停用，请选择启用的子类", 422)


def state(garment: Garment) -> dict[str, JsonValue]:
    return {
        "profile": LifecycleProfile.model_validate(garment.lifecycle).model_dump(mode="json"),
        "ownership": garment.ownership,
        "subtype_id": str(garment.subtype_id) if garment.subtype_id else None,
        "availability": garment.attributes.get("availability"),
    }


def record(
    db: Session,
    garment: Garment,
    action: str,
    before: dict[str, JsonValue],
    occurred_on: date,
    reason: str = "",
    related: UUID | None = None,
) -> None:
    db.add(
        LifecycleEvent(
            garment_id=garment.id,
            action=action,
            occurred_on=occurred_on,
            reason=reason,
            version=garment.version,
            related_event_id=related,
            before=before,
            after=state(garment),
        )
    )
