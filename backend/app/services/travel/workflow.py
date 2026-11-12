"""One bounded task for the whole trip; immutable publication in one transaction."""

from datetime import datetime
from typing import cast
from uuid import UUID, uuid4

from pydantic import JsonValue, ValidationError
from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import utcnow
from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.db.travel import TravelRevision
from app.db.wardrobe import Garment, Tag
from app.domain.travel import validate_plan
from app.jobs.queue import check_lease
from app.providers import travel as provider
from app.schemas.travel import ModelTravel, TravelDay, TravelInput, TravelResult
from app.services.garment_state import eligible
from app.services.jobs import append_event, get_job
from app.services.outfits.snapshots import snapshot
from app.services.travel.plans import require, view
from app.services.travel.weather import forecasts


def run(job_id: UUID, token: UUID) -> None:
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        if job.status == "succeeded":
            return
        check_lease(job, token)
        data = dict(job.input_snapshot)
    payload = TravelInput.model_validate(data["request"])
    candidates = cast(dict[str, dict[str, JsonValue]], data["candidates"])
    saved_days = cast(dict[str, dict[str, JsonValue]], data["preserved"])
    preserved = {
        day: [str(i["garment_id"]) for i in cast(list[dict[str, JsonValue]], value["items"])]
        for day, value in saved_days.items()
    }
    if not candidates:
        raise AppError("INSUFFICIENT_WARDROBE", "没有可用衣服，请先录入衣橱")
    if "weather" not in data:
        weather = forecasts(payload)
        with session_factory().begin() as db:
            job = get_job(db, job_id, lock=True)
            check_lease(job, token)
            job.input_snapshot = {**job.input_snapshot, "weather": weather}
        data["weather"] = weather
    context: dict[str, JsonValue] = {
        "request": data["request"],
        "candidates": data["candidates"],
        "preferences": data["preferences"],
        "preserved": {k: [i for i in v] for k, v in preserved.items()},
        "weather": data["weather"],
        "adjust_date": data["adjust_date"],
        "message": data["message"],
    }
    correction = ""
    for attempt in range(2):
        try:
            raw = call(job_id, token, attempt, {**context, "correction": correction}, data)
            proposal = ModelTravel.model_validate(raw)
            warnings = validate_plan(payload, proposal, candidates, preserved)
            publish(job_id, token, proposal, warnings, data, saved_days)
            return
        except ValidationError as exc:
            correction = "JSON字段不符合schema，请核对日期及单品UUID。"
            if attempt == 1:
                raise AppError("INVALID_MODEL_OUTPUT", correction) from exc
        except AppError as exc:
            if exc.code != "INVALID_MODEL_OUTPUT" or attempt == 1:
                raise
            correction = exc.message
    raise AppError("INVALID_MODEL_OUTPUT", "未能得到完整合法行程")


def call(
    job_id: UUID,
    token: UUID,
    attempt: int,
    context: dict[str, JsonValue],
    data: dict[str, JsonValue],
) -> dict[str, JsonValue]:
    remaining = (datetime.fromisoformat(str(data["deadline"])) - utcnow()).total_seconds()
    if remaining <= 0:
        raise AppError("BUDGET_EXCEEDED", "旅行任务超过五分钟总期限")
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        old = db.get(ModelCall, (job_id, "travel", attempt))
        if old:
            if old.response is not None:
                return old.response
            if old.state == "invalid":
                raise AppError("INVALID_MODEL_OUTPUT", "模型返回无效JSON")
            raise AppError("CALL_RESULT_UNKNOWN", "已发送调用结果未知，不自动重发")
        settings = get_settings()
        if (
            data["prompt_version"] != provider.PROMPT_VERSION
            or data["provider_mode"] != settings.provider_mode
            or data["model"] != settings.qwen_model
        ):
            raise AppError("PROVIDER_CONFIG_CHANGED", "模型配置已变化，请核对后重新生成")
        db.add(ModelCall(job_id=job_id, step="travel", attempt=attempt, state="sent"))
        append_event(
            db, job, "progress", {"stage": "travel", "message": "正在规划整段行程并核对行李"}
        )
    try:
        raw = (
            provider.fake(context)
            if data["provider_mode"] == "fake"
            else provider.invoke(context, remaining)
        )
    except AppError as exc:
        if exc.code == "INVALID_MODEL_OUTPUT":
            with session_factory().begin() as db:
                record = db.get(ModelCall, (job_id, "travel", attempt))
                assert record
                record.state = "invalid"
        raise
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        record = db.get(ModelCall, (job_id, "travel", attempt))
        assert record
        record.state, record.response = "received", raw
    return raw


def publish(
    job_id: UUID,
    token: UUID,
    proposal: ModelTravel,
    warnings: list[str],
    data: dict[str, JsonValue],
    saved_days: dict[str, dict[str, JsonValue]],
) -> None:
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        if datetime.fromisoformat(str(data["deadline"])) <= utcnow():
            raise AppError("BUDGET_EXCEEDED", "旅行任务超过五分钟总期限")
        plan = require(db, UUID(str(data["travel_id"])), True)
        if plan.current_job_id != job.id:
            raise AppError("VERSION_CONFLICT", "当前任务已被替换")
        ids = {gid for d in proposal.days for gid in d.garment_ids}
        garments = {
            g.id: g
            for g in db.scalars(
                select(Garment).where(Garment.id.in_(ids)).order_by(Garment.id).with_for_update()
            )
        }
        versions = cast(dict[str, JsonValue], data["candidate_versions"])
        if ids != garments.keys() or any(
            not eligible(g) or g.version != versions.get(str(g.id)) for g in garments.values()
        ):
            raise AppError(
                "CONSTRAINT_CONFLICT", "单品状态或资料已变化，旧计划已保留，请重新核对后生成"
            )
        tags = {str(t.id): t.name for t in db.scalars(select(Tag))}
        payload = TravelInput.model_validate(data["request"])
        weather = cast(dict[str, dict[str, JsonValue]], data["weather"])
        days = []
        for day, requested in zip(proposal.days, payload.days, strict=True):
            key = str(day.date)
            if key in saved_days:
                days.append(saved_days[key])
                continue
            evidence = ["单品未记录的场合、风格和适温能力仍未知，请自行核对。"]
            if weather[key]["source"] == "unknown":
                evidence.insert(0, "这一天的天气未知，请出发前补充核对。")
            days.append(
                TravelDay(
                    date=day.date,
                    occasion=requested.occasion,
                    items=[snapshot(db, garments[gid], tags) for gid in day.garment_ids],
                    weather=weather[key],
                    warnings=evidence,
                ).model_dump(mode="json")
            )
        previous = view(db, plan)
        revision = TravelRevision(
            id=uuid4(),
            plan_id=plan.id,
            job_id=job.id,
            number=(previous.revision.number + 1) if previous.revision else 1,
            days=days,
            request=data["request"],
            provider_mode=str(data["provider_mode"]),
            warnings=warnings,
        )
        db.add(revision)
        db.flush()
        str_ids = set(map(str, ids))
        plan.packed_ids = sorted(set(plan.packed_ids) & str_ids)
        plan.added_ids = sorted(str_ids - {str(i.garment_id) for i in previous.packing})
        plan.current_revision_id = revision.id
        plan.version += 1
        result = TravelResult(travel_id=plan.id, travel_revision_id=revision.id).model_dump(
            mode="json"
        )
        job.status, job.result, job.lease_token = "succeeded", result, None
        append_event(db, job, "result", result)
        append_event(db, job, "status", {"status": "succeeded"})
