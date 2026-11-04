from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.session import session_factory
from app.db.templates import ConditionTemplate
from app.db.wardrobe import Tag
from app.schemas.templates import (
    TemplateConditions,
    TemplateCreate,
    TemplateDelete,
    TemplateDeleted,
    TemplateUpdate,
    TemplateView,
)
from app.services.operations import owner_id, receipt, save_receipt


def issues(db: Session, row: ConditionTemplate, known_tags: set[UUID] | None = None) -> list[str]:
    try:
        fields = TemplateConditions.model_validate(row.conditions)
    except ValidationError:
        return ["模板包含当前不支持的字段或取值，请编辑修正后使用。"]
    existing = (
        known_tags
        if known_tags is not None
        else set(db.scalars(select(Tag.id).where(Tag.id.in_(fields.custom_tag_ids))))
    )
    return (
        ["模板中有已删除的标签，请编辑移除后使用。"]
        if not set(fields.custom_tag_ids).issubset(existing)
        else []
    )


def view(db: Session, row: ConditionTemplate, known_tags: set[UUID] | None = None) -> TemplateView:
    return TemplateView(
        id=row.id,
        name=row.name,
        conditions=row.conditions,
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
        issues=issues(db, row, known_tags),
    )


def require(db: Session, template_id: UUID, lock: bool = False) -> ConditionTemplate:
    query = select(ConditionTemplate).where(
        ConditionTemplate.id == template_id,
        ConditionTemplate.owner_id == owner_id(db),
        ConditionTemplate.deleted_at.is_(None),
    )
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise AppError("TEMPLATE_NOT_FOUND", "模板已删除或不存在，请重新读取列表", 404)
    return row


def listing() -> list[TemplateView]:
    with session_factory()() as db:
        rows = db.scalars(
            select(ConditionTemplate)
            .where(
                ConditionTemplate.owner_id == owner_id(db), ConditionTemplate.deleted_at.is_(None)
            )
            .order_by(ConditionTemplate.created_at.desc(), ConditionTemplate.id)
        )
        known_tags = set(db.scalars(select(Tag.id)))
        return [view(db, row, known_tags) for row in rows]


def get(template_id: UUID) -> TemplateView:
    with session_factory()() as db:
        return view(db, require(db, template_id))


def validate_tags(db: Session, fields: TemplateConditions) -> None:
    # Conflict with tag deletion while validating references; no template rewrite on deletion.
    db.execute(text("LOCK TABLE tags IN SHARE MODE"))
    if set(db.scalars(select(Tag.id).where(Tag.id.in_(fields.custom_tag_ids)))) != set(
        fields.custom_tag_ids
    ):
        raise AppError("TAG_NOT_FOUND", "模板中的标签已删除，请移除后保存", 422)


def create(payload: TemplateCreate, key: str) -> TemplateView:
    with session_factory().begin() as db:
        digest, old = receipt(db, "template-create", key, payload.model_dump(mode="json"))
        if old:
            return TemplateView.model_validate(old.response)
        db.execute(text("SELECT pg_advisory_xact_lock(53007)"))
        owner = owner_id(db)
        count = db.scalar(
            select(func.count())
            .select_from(ConditionTemplate)
            .where(ConditionTemplate.owner_id == owner, ConditionTemplate.deleted_at.is_(None))
        )
        if count is not None and count >= 100:
            raise AppError("TEMPLATE_LIMIT", "最多保留 100 个模板，请先删除不再使用的模板", 422)
        validate_tags(db, payload.conditions)
        row = ConditionTemplate(
            owner_id=owner, name=payload.name, conditions=payload.conditions.model_dump(mode="json")
        )
        db.add(row)
        db.flush()
        result = view(db, row)
        save_receipt(db, "template-create", key, digest, result.model_dump(mode="json"))
        return result


def update(template_id: UUID, payload: TemplateUpdate, key: str) -> TemplateView:
    with session_factory().begin() as db:
        operation = f"template-update:{template_id}"
        digest, old = receipt(db, operation, key, payload.model_dump(mode="json"))
        if old:
            return TemplateView.model_validate(old.response)
        validate_tags(db, payload.conditions)
        row = require(db, template_id, True)
        if row.version != payload.expected_version:
            raise AppError("VERSION_CONFLICT", "模板已更新，请保留草稿并读取最新版本")
        row.name, row.conditions = payload.name, payload.conditions.model_dump(mode="json")
        row.version += 1
        row.updated_at = utcnow()
        result = view(db, row)
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result


def delete(template_id: UUID, payload: TemplateDelete, key: str) -> TemplateDeleted:
    with session_factory().begin() as db:
        operation = f"template-delete:{template_id}"
        digest, old = receipt(db, operation, key, payload.model_dump(mode="json"))
        if old:
            return TemplateDeleted.model_validate(old.response)
        row = require(db, template_id, True)
        if row.version != payload.expected_version:
            raise AppError("VERSION_CONFLICT", "模板已更新，请重新核对后删除")
        row.version += 1
        row.deleted_at = row.updated_at = utcnow()
        result = TemplateDeleted(id=row.id, version=row.version)
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result
