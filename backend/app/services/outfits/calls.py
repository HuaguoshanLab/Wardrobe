from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import func, select

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.jobs.queue import check_lease
from app.providers import qwen
from app.providers.outfit_fake import fake_intent, fake_outfits
from app.schemas.outfits import Intent, OutfitContext
from app.services.jobs import append_event, get_job


def model_call(
    job_id: UUID,
    token: UUID,
    step: str,
    attempt: int,
    context: OutfitContext,
    intent: Intent | None = None,
    correction: str = "",
) -> dict[str, JsonValue]:
    remaining = (context.deadline - utcnow()).total_seconds()
    if remaining <= 0:
        raise AppError("BUDGET_EXCEEDED", "搭配任务超过总时限")
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        old = db.get(ModelCall, (job_id, step, attempt))
        if old:
            if old.response is not None:
                return old.response
            if old.state == "invalid":
                raise AppError("INVALID_MODEL_OUTPUT", "模型响应格式无效")
            raise AppError("CALL_RESULT_UNKNOWN", "已有调用结果未知，不自动重发")
        count = (
            db.scalar(select(func.count()).select_from(ModelCall).where(ModelCall.job_id == job_id))
            or 0
        )
        if count >= 4:
            raise AppError("BUDGET_EXCEEDED", "模型请求次数达到预算上限")
        db.add(ModelCall(job_id=job_id, step=step, attempt=attempt, state="sent"))
        mode = str(job.input_snapshot["provider_mode"])
        message = str(job.input_snapshot.get("message") or "")
        append_event(
            db,
            job,
            "progress",
            {
                "stage": step,
                "message": "正在解析调整要求" if step == "intent" else "正在生成并校验搭配",
            },
        )
    try:
        if mode == "fake":
            result = (
                fake_intent(context, message) if step == "intent" else fake_outfits(context, intent)
            ).model_dump(mode="json")
        else:
            result = qwen.invoke(
                {
                    "context": context.model_dump(mode="json"),
                    "message": message,
                    "intent": intent.model_dump(mode="json") if intent else None,
                    "correction": correction,
                },
                step,
                remaining,
            )
    except AppError as exc:
        if exc.code == "INVALID_MODEL_OUTPUT":
            with session_factory().begin() as db:
                call = db.get(ModelCall, (job_id, step, attempt))
                assert call is not None
                call.state = "invalid"
        raise
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        call = db.get(ModelCall, (job_id, step, attempt))
        assert call is not None
        call.state, call.response = "received", result
    return result
