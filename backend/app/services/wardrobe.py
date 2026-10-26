import unicodedata
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.session import session_factory
from app.db.wardrobe import Garment, MediaAsset, Tag
from app.domain.taxonomy import attribute_errors
from app.schemas.wardrobe import Attributes, GarmentView
from app.services.operations import owner_id


def asset(db: Session, media_id: UUID) -> MediaAsset:
    value = db.get(MediaAsset, media_id)
    if value is None:
        raise AppError("NOT_FOUND", "图片不存在", 404)
    return value


def image_url(media: MediaAsset, variant: str = "original") -> str | None:
    if not media.display_key:
        return None
    selected = "cutout" if variant == "cutout" and media.cutout_key else "original"
    return f"/api/v1/media/{media.id}?variant={selected}"


def validate_attributes(db: Session, attributes: Attributes, media: MediaAsset) -> list[str]:
    errors = attribute_errors(attributes.model_dump())
    if not media.display_key:
        errors.append("图片未成功转换")
    if attributes.display_variant == "cutout" and not media.cutout_key:
        errors.append("去背景图尚不可用")
    if attributes.custom_tag_ids:
        tags = set(db.scalars(select(Tag.id).where(Tag.id.in_(attributes.custom_tag_ids))).all())
        if tags != set(attributes.custom_tag_ids):
            errors.append("部分自定义标签不存在")
    return errors


def garment_view(db: Session, garment: Garment) -> GarmentView:
    media = asset(db, garment.image_asset_id)
    attrs = Attributes.model_validate(garment.attributes)
    return GarmentView(
        **attrs.model_dump(),
        id=garment.id,
        image_asset_id=media.id,
        is_demo=garment.is_demo,
        version=garment.version,
        created_at=garment.created_at,
        image_url=image_url(media, attrs.display_variant) or "",
        has_cutout=bool(media.cutout_key),
    )


def find_garment(db: Session, garment_id: UUID, *, lock: bool = False) -> Garment:
    query = select(Garment).where(Garment.id == garment_id, Garment.deleted_at.is_(None))
    if lock:
        query = query.with_for_update()
    garment = db.scalar(query)
    if garment is None:
        raise AppError("NOT_FOUND", "衣服不存在或已删除", 404)
    return garment


def patch_garment(garment_id: UUID, version: int, changes: dict[str, object]) -> GarmentView:
    with session_factory().begin() as db:
        garment = find_garment(db, garment_id, lock=True)
        if garment.version != version:
            raise AppError("VERSION_CONFLICT", "衣服已更新，请重新读取后编辑")
        attrs = Attributes.model_validate({**garment.attributes, **changes})
        errors = validate_attributes(db, attrs, asset(db, garment.image_asset_id))
        if errors:
            raise AppError("VALIDATION_ERROR", "；".join(errors), 422)
        garment.attributes, garment.version = attrs.model_dump(mode="json"), garment.version + 1
        db.flush()
        return garment_view(db, garment)


def delete_garment(garment_id: UUID, version: int) -> None:
    with session_factory().begin() as db:
        garment = find_garment(db, garment_id, lock=True)
        if garment.version != version:
            raise AppError("VERSION_CONFLICT", "衣服已更新，请刷新")
        garment.deleted_at, garment.version = utcnow(), garment.version + 1


def get_or_create_tag(db: Session, name: str) -> Tag:
    from sqlalchemy.dialects.postgresql import insert

    name = unicodedata.normalize("NFKC", name).strip()
    if not name or len(name) > 40:
        raise AppError("INVALID_TAG", "标签需为 1–40 个字符", 422)
    normalized = name.casefold()
    db.execute(
        insert(Tag)
        .values(owner_id=owner_id(db), name=name, normalized_name=normalized)
        .on_conflict_do_nothing(index_elements=["normalized_name"])
    )
    tag = db.scalar(select(Tag).where(Tag.normalized_name == normalized))
    assert tag is not None
    return tag
