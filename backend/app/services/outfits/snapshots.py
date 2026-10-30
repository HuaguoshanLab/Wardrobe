"""Freeze real garment attributes and a stable display-image reference."""

from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.outfits import OutfitImage
from app.db.wardrobe import Garment
from app.media.storage import path_for
from app.schemas.outfits import ItemSnapshot
from app.schemas.wardrobe import Attributes
from app.services.wardrobe import asset


def snapshot(db: Session, garment: Garment, tags: dict[str, str]) -> ItemSnapshot:
    media = asset(db, garment.image_asset_id)
    key = (
        media.cutout_key
        if garment.attributes.get("display_variant") == "cutout"
        else media.display_key
    )
    if not key or not path_for(key).is_file():
        raise AppError("CONSTRAINT_CONFLICT", "展示图片不可用，请先修复单品图片")
    image = OutfitImage(id=uuid4(), media_asset_id=media.id, storage_key=key)
    db.add(image)
    attributes = Attributes.model_validate(garment.attributes)
    attrs = attributes.model_dump(mode="json")
    attrs["tag_names"] = [tags.get(str(t), "") for t in attributes.custom_tag_ids]
    return ItemSnapshot(
        item_id=uuid4(),
        slot=str(attributes.category),
        source="wardrobe",
        garment_id=garment.id,
        display_asset_id=image.id,
        image_url=f"/api/v1/outfit-images/{image.id}",
        attributes=attrs,
    )
