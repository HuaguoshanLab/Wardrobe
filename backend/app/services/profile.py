from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.profile import CityRecord, Profile
from app.db.session import session_factory
from app.db.wardrobe import Tag
from app.schemas.profile import (
    ConditionPreview,
    Preferences,
    PreferencesPatch,
    PreferencesView,
    Requirements,
)
from app.schemas.weather import City, LocationPatch, LocationView
from app.services.operations import owner_id, receipt, save_receipt


def profile(db: Session, *, lock: bool = False) -> Profile:
    owner = owner_id(db)
    # A new database initializes system_state after Alembic; insert lazily and atomically.
    db.execute(
        insert(Profile)
        .values(owner_id=owner, preferences={}, preference_version=1, location_version=1)
        .on_conflict_do_nothing()
    )
    query = select(Profile).where(Profile.owner_id == owner)
    if lock:
        query = query.with_for_update()
    return db.scalars(query).one()


def preferences() -> PreferencesView:
    with session_factory().begin() as db:
        row = profile(db)
        return PreferencesView(
            preferences=Preferences.model_validate(row.preferences), version=row.preference_version
        )


def update_preferences(payload: PreferencesPatch, key: str) -> PreferencesView:
    with session_factory().begin() as db:
        digest, old = receipt(
            db, "preferences", key, payload.model_dump(mode="json", exclude_unset=True)
        )
        if old:
            return PreferencesView.model_validate(old.response)
        row = profile(db, lock=True)
        if row.preference_version != payload.expected_version:
            raise AppError("VERSION_CONFLICT", "偏好已在其他页面更新，请重新载入后编辑")
        merged = Preferences.model_validate(
            {**row.preferences, **payload.preferences.model_dump(mode="json", exclude_unset=True)}
        )
        row.preferences = merged.model_dump(mode="json")
        row.preference_version += 1
        result = PreferencesView(preferences=merged, version=row.preference_version)
        save_receipt(db, "preferences", key, digest, result.model_dump(mode="json"))
        return result


def location() -> LocationView:
    with session_factory().begin() as db:
        row = profile(db)
        return LocationView(
            city=City.model_validate(row.city) if row.city else None, version=row.location_version
        )


def update_location(payload: LocationPatch, key: str) -> LocationView:
    with session_factory().begin() as db:
        digest, old = receipt(db, "location", key, payload.model_dump(mode="json"))
        if old:
            return LocationView.model_validate(old.response)
        row = profile(db, lock=True)
        if row.location_version != payload.expected_version:
            raise AppError("VERSION_CONFLICT", "城市已更新，请重新载入后选择")
        city = payload.city
        if city and city.source == "qweather":
            known = db.get(CityRecord, city.id)
            if known is None or known.data != city.model_dump(mode="json"):
                raise AppError("CITY_NOT_VERIFIED", "请从城市搜索结果重新选择", 422)
        row.city = city.model_dump(mode="json") if city else None
        row.location_version += 1
        result = LocationView(city=city, version=row.location_version)
        save_receipt(db, "location", key, digest, result.model_dump(mode="json"))
        return result


def preview(requirements: Requirements) -> ConditionPreview:
    with session_factory().begin() as db:
        row = profile(db)
        tags = set(db.scalars(select(Tag.id).where(Tag.id.in_(requirements.custom_tag_ids))))
        if tags != set(requirements.custom_tag_ids):
            raise AppError("TAG_NOT_FOUND", "条件中的标签已删除，请重新选择", 422)
        effective = Preferences.model_validate(row.preferences)
        if requirements.style_codes is not None:
            effective.style_codes = requirements.style_codes
        return ConditionPreview(
            requirements=requirements,
            effective_preferences=effective,
            preference_version=row.preference_version,
        )
