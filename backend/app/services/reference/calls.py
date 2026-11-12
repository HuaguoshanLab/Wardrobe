from datetime import datetime
from uuid import UUID

from pydantic import JsonValue

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import utcnow
from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.jobs.queue import check_lease
from app.media.storage import path_for
from app.providers import reference as provider
from app.services.jobs import append_event, get_job


def call(
    job_id: UUID,
    token: UUID,
    attempt: int,
    context: dict[str, JsonValue],
    data: dict[str, JsonValue],
) -> dict[str, JsonValue]:
    action = str(data["action"])
    step = f"reference_{action}"
    remaining = (datetime.fromisoformat(str(data["deadline"])) - utcnow()).total_seconds()
    if remaining <= 0:
        raise AppError("BUDGET_EXCEEDED", "参考任务超过五分钟总期限")
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        old = db.get(ModelCall, (job_id, step, attempt))
        if old:
            if old.response is not None:
                return old.response
            if old.state == "invalid":
                raise AppError("INVALID_MODEL_OUTPUT", "模型返回无效JSON")
            raise AppError("CALL_RESULT_UNKNOWN", "已发送调用结果未知，不自动重发")
        settings = get_settings()
        mode = settings.recognition_mode if action == "analyze" else settings.provider_mode
        if (
            data["prompt_version"] != provider.PROMPT_VERSION
            or data["provider_mode"] != mode
            or data["model"] != settings.qwen_model
        ):
            raise AppError("PROVIDER_CONFIG_CHANGED", "模型配置已变化，请核对后重新操作")
        db.add(ModelCall(job_id=job_id, step=step, attempt=attempt, state="sent"))
        append_event(
            db,
            job,
            "progress",
            {
                "stage": step,
                "message": "正在分析参考图" if action == "analyze" else "正在核对衣橱近似方案",
            },
        )
    try:
        raw = (
            provider.fake(action, context)
            if mode == "fake"
            else provider.invoke(
                action,
                context,
                path_for(str(data["display_key"])).read_bytes() if action == "analyze" else None,
                remaining,
            )
        )
    except AppError as exc:
        if exc.code == "INVALID_MODEL_OUTPUT":
            with session_factory().begin() as db:
                record = db.get(ModelCall, (job_id, step, attempt))
                assert record
                record.state = "invalid"
        raise
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        record = db.get(ModelCall, (job_id, step, attempt))
        assert record
        record.state, record.response = "received", raw
    return raw
