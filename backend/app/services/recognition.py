"""One durable recognition attempt per job/row; no implicit replay of unknown calls."""

from uuid import UUID

from pydantic import JsonValue
from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.recognition import RecognitionCall
from app.db.session import session_factory
from app.db.wardrobe import ImportRow
from app.jobs.queue import check_lease
from app.media.storage import path_for
from app.providers.recognition import PROMPT_VERSION, recognize
from app.schemas.recognition import RecognitionResult
from app.services.jobs import get_job


def configuration() -> dict[str, JsonValue]:
    settings = get_settings()
    return {
        "mode": settings.recognition_mode,
        "model": settings.qwen_model,
        "base_url": settings.qwen_base_url,
        "prompt_version": PROMPT_VERSION,
    }


def recognize_row(
    job_id: UUID, token: UUID, row_id: UUID, display: str
) -> tuple[RecognitionResult, str]:
    settings = get_settings()
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        row = db.scalar(select(ImportRow).where(ImportRow.id == row_id).with_for_update())
        assert row is not None
        if row.skipped or row.confirmed_garment_id:
            raise AppError("ROW_FINALIZED", "审核行已确认或移除")
        old = db.get(RecognitionCall, (job_id, row_id))
        if old:
            if old.response is not None:
                return RecognitionResult.model_validate(old.response), str(old.config["mode"])
            if old.state == "failed":
                raise AppError(
                    old.error_code or "RECOGNITION_FAILED", "此前识别已失败，请手工填写或显式重试"
                )
            raise AppError("CALL_RESULT_UNKNOWN", "此前识别结果未知；显式重试可能再次计费")
        snapshot = job.input_snapshot.get("recognition")
        if not isinstance(snapshot, dict) or snapshot != configuration():
            raise AppError("PROVIDER_CONFIG_CHANGED", "识别配置已变更或任务来自旧版本，请显式重试")
        if settings.recognition_mode == "disabled" or (
            settings.recognition_mode == "qwen" and not settings.qwen_configured
        ):
            raise AppError("PROVIDER_NOT_CONFIGURED", "识别服务未配置，请手动填写品类", 503)
        # The Job row lock serializes insertion. A concurrent replay sees sent and stops.
        db.add(
            RecognitionCall(
                job_id=job_id,
                row_id=row_id,
                state="sent",
                config={**snapshot, "display_key": display, "row_version": row.version},
            )
        )
    try:
        result = recognize(path_for(display).read_bytes(), settings)
        result = RecognitionResult.model_validate(result)
    except AppError as exc:
        with session_factory().begin() as db:
            call = db.get(RecognitionCall, (job_id, row_id))
            assert call is not None
            call.state = "unknown" if exc.code == "CALL_RESULT_UNKNOWN" else "failed"
            call.error_code = exc.code
        raise
    except Exception as exc:
        # If persistence/transport fails unexpectedly, conservatively retain sent.
        raise AppError("CALL_RESULT_UNKNOWN", "识别结果未能可靠保存；显式重试可能再次计费") from exc
    try:
        with session_factory().begin() as db:
            call = db.get(RecognitionCall, (job_id, row_id))
            assert call is not None
            call.response = result.model_dump(mode="json")
            call.state = "received"
    except Exception as exc:
        raise AppError("CALL_RESULT_UNKNOWN", "识别响应未能可靠持久化，不自动重发") from exc
    # Lease/cancellation/manual edits are checked again by run_step before merging.
    return result, settings.recognition_mode
