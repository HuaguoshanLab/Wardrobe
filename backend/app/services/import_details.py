"""Resolve initial facts only on explicit confirmation; preview never creates subtypes."""

from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.lifecycle import GarmentSubtype
from app.schemas.import_details import ImportDetails
from app.schemas.lifecycle import LifecycleProfile
from app.schemas.wardrobe import Attributes, ImportDraft


def attributes(draft: ImportDraft) -> Attributes:
    return Attributes.model_validate(draft.model_dump(include=set(Attributes.model_fields)))


def profile(draft: ImportDraft) -> LifecycleProfile:
    fields = set(ImportDetails.model_fields) - {"subtype_name"}
    return LifecycleProfile.model_validate(draft.model_dump(include=fields))


def subtype_errors(db: Session, draft: ImportDraft) -> list[str]:
    if not draft.subtype_name:
        return []
    row = db.scalar(
        select(GarmentSubtype).where(
            GarmentSubtype.category == draft.category, GarmentSubtype.name == draft.subtype_name
        )
    )
    return ["子类已停用，请清空或选择启用的子类"] if row and not row.active else []


def resolve_subtype(db: Session, draft: ImportDraft) -> UUID | None:
    if not draft.subtype_name:
        return None
    # ON CONFLICT serializes concurrent confirmations of the same new subtype.
    db.execute(
        insert(GarmentSubtype)
        .values(
            id=uuid4(), category=draft.category, name=draft.subtype_name, active=True, version=1
        )
        .on_conflict_do_nothing(index_elements=["category", "name"])
    )
    row = db.scalar(
        select(GarmentSubtype)
        .where(GarmentSubtype.category == draft.category, GarmentSubtype.name == draft.subtype_name)
        .with_for_update(read=True)
    )
    assert row
    if not row.active:
        raise AppError("INACTIVE_SUBTYPE", "子类已停用，请清空或选择启用的子类", 422)
    return row.id
