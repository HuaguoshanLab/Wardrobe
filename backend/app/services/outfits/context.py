from datetime import timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import JsonValue
from sqlalchemy import select

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.session import session_factory
from app.db.wardrobe import Garment, Tag
from app.jobs.queue import check_lease
from app.schemas.profile import Preferences, Requirements
from app.services.jobs import append_event, get_job
from app.services.outfits.sessions import check_tags, get_revision, get_session, invalid_ids
from app.services.profile import profile
from app.services.wardrobe import garment_view
from app.services.weather import get_weather


def prepare_context(job_id: UUID, token: UUID) -> dict[str, JsonValue]:
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        if job.status == "succeeded":
            return {}
        check_lease(job, token)
        saved = job.input_snapshot.get("context")
        if isinstance(saved, dict):
            return saved
        data = dict(job.input_snapshot)
        row = get_session(db, UUID(str(data["session_id"])))
        requirements = Requirements.model_validate(data["requirements"])
        check_tags(db, requirements)
        pref = profile(db)
        preferences = Preferences.model_validate(pref.preferences)
        if requirements.style_codes is not None:
            preferences.style_codes = requirements.style_codes
        if invalid_ids(db, row.locked_garment_ids):
            raise AppError("CONSTRAINT_CONFLICT", "锁定单品已失效，请解锁或恢复")
        garments = list(
            db.scalars(
                select(Garment)
                .where(
                    Garment.deleted_at.is_(None),
                    Garment.is_demo.is_(False),
                    Garment.attributes["availability"].astext == "available",
                )
                .order_by(Garment.id)
                .limit(501)
            )
        )
        if len(garments) > 500:
            raise AppError("CANDIDATE_LIMIT", "当前候选超过 500 件，请先缩小可用衣橱范围", 422)
        base = (
            get_revision(db, UUID(str(data["base_revision_id"])))
            if data.get("base_revision_id")
            else None
        )
        context: dict[str, JsonValue] = {
            "requirements": requirements.model_dump(mode="json"),
            "preferences": preferences.model_dump(mode="json"),
            "preference_version": pref.preference_version,
            "city": pref.city,
            "candidates": [garment_view(db, g).model_dump(mode="json") for g in garments],
            "tags": {str(t.id): t.name for t in db.scalars(select(Tag))},
            "base_items": [dict(i) for i in base.items] if base else [],
            "locked_garment_ids": [str(i) for i in row.locked_garment_ids],
            "deadline": (utcnow() + timedelta(seconds=300)).isoformat(),
            "weather": {},
        }
    # Network I/O never holds business row locks. Empty wardrobes need no weather/model call.
    if garments:
        now = utcnow()
        today = now.astimezone(ZoneInfo("Asia/Shanghai")).date()
        if requirements.weather_override:
            context["weather"] = {
                "source": "manual",
                "valid_for": str(today),
                "fetched_at": now.isoformat(),
                "city": context["city"],
                **requirements.weather_override.model_dump(mode="json"),
            }
        else:
            city = context["city"]
            if not isinstance(city, dict) or not city.get("id"):
                raise AppError("WEATHER_REQUIRED", "请填写本次温度和天气，或选择有效和风城市", 422)
            try:
                current = get_weather(str(city["id"])).current
            except AppError as exc:
                raise AppError("WEATHER_REQUIRED", "天气不可用，请手动填写后重新生成", 422) from exc
            if (
                current is None
                or current.stale
                or current.valid_for != today
                or current.expires_at <= utcnow()
            ):
                raise AppError("WEATHER_REQUIRED", "实况已过期，请手动填写天气后重试", 422)
            context["weather"] = current.model_dump(mode="json")
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        job.input_snapshot = {**job.input_snapshot, "context": context}
        append_event(
            db, job, "progress", {"stage": "context", "message": "已读取最新偏好、天气和可用衣服"}
        )
    return context
