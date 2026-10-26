from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.errors import AppError
from app.db.session import session_factory
from app.db.wardrobe import Garment, ImportRow, Tag
from app.schemas.wardrobe import TagPatch, TagView


def rename_tag(tag_id: UUID, payload: TagPatch) -> TagView:
    import unicodedata

    with session_factory().begin() as db:
        tag = db.scalar(select(Tag).where(Tag.id == tag_id).with_for_update())
        if not tag:
            raise AppError("NOT_FOUND", "标签不存在", 404)
        if tag.version != payload.expected_version:
            raise AppError("VERSION_CONFLICT", "标签已更新")
        name = unicodedata.normalize("NFKC", payload.name).strip()
        if not name or len(name) > 40:
            raise AppError("INVALID_TAG", "标签需为 1–40 个字符", 422)
        if db.scalar(
            select(Tag.id).where(Tag.normalized_name == name.casefold(), Tag.id != tag_id)
        ):
            raise AppError("TAG_EXISTS", "同名标签已存在")
        tag.name, tag.normalized_name, tag.version = name, name.casefold(), tag.version + 1
        try:
            db.flush()
        except IntegrityError as exc:
            raise AppError("TAG_EXISTS", "同名标签已存在") from exc
        return TagView.model_validate(tag)


def delete_tag(tag_id: UUID, version: int) -> None:
    with session_factory().begin() as db:
        tag = db.scalar(select(Tag).where(Tag.id == tag_id).with_for_update())
        if not tag:
            raise AppError("NOT_FOUND", "标签不存在", 404)
        if tag.version != version:
            raise AppError("VERSION_CONFLICT", "标签已更新")
        for item in db.scalars(
            select(Garment).where(Garment.deleted_at.is_(None)).with_for_update()
        ):
            values = item.attributes.get("custom_tag_ids", [])
            if isinstance(values, list) and str(tag_id) in values:
                item.attributes = {
                    **item.attributes,
                    "custom_tag_ids": [v for v in values if v != str(tag_id)],
                }
                item.version += 1
        for row in db.scalars(
            select(ImportRow).where(ImportRow.confirmed_garment_id.is_(None)).with_for_update()
        ):
            values = row.draft.get("custom_tag_ids", [])
            if isinstance(values, list) and str(tag_id) in values:
                row.draft = {**row.draft, "custom_tag_ids": [v for v in values if v != str(tag_id)]}
                row.version += 1
        db.delete(tag)
