"""Bounded subtype choices for vision; names are data, not instructions."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.lifecycle import GarmentSubtype
from app.schemas.recognition import RecognitionResult
from app.services.subtypes import SUGGESTIONS

# Inventory names remain available for human selection; vision cannot establish these facts.
NON_VISUAL_NAMES = {"薄外套", "羽绒服"}
VISION_DEFAULTS = {**SUGGESTIONS, "outerwear": ["夹克", "大衣"]}


def catalog(db: Session) -> dict[str, list[str]]:
    rows = list(
        db.scalars(
            select(GarmentSubtype)
            .where(GarmentSubtype.active.is_(True), GarmentSubtype.name.not_in(NON_VISUAL_NAMES))
            .order_by(GarmentSubtype.category, GarmentSubtype.name)
            .limit(500)
        )
    )
    choices = {category: list(names) for category, names in VISION_DEFAULTS.items()}
    # Inactive built-in names must remain excluded even beyond the active-name cap.
    defaults = {name for names in choices.values() for name in names}
    inactive = db.scalars(
        select(GarmentSubtype).where(
            GarmentSubtype.active.is_(False), GarmentSubtype.name.in_(defaults)
        )
    )
    for row in inactive:
        names = choices.setdefault(row.category, [])
        if row.name in names:
            names.remove(row.name)
    for row in reversed(rows):
        names = choices.setdefault(row.category, [])
        if row.name in names:
            names.remove(row.name)
        names.insert(0, row.name)
    return choices


def validate(result: RecognitionResult, choices: dict[str, list[str]]) -> None:
    attrs = result.attributes
    if attrs.subtype_name and attrs.subtype_name not in choices.get(attrs.category or "", []):
        raise AppError("INVALID_MODEL_OUTPUT", "子类不在本次品类候选中，请人工填写或显式重试", 503)
