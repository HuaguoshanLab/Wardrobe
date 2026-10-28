"""Worker-only task envelope; optional reads cannot change task outcome."""

from collections.abc import Callable
from functools import wraps
from uuid import UUID

from app.db.session import session_factory
from app.observability import runtime
from app.observability.runtime import observation, session, warning
from app.services.jobs import get_job, read_job


def trace_job(fn: Callable[[UUID, UUID], None]) -> Callable[[UUID, UUID], None]:
    @wraps(fn)
    def wrapped(job_id: UUID, token: UUID) -> None:
        if runtime.client() is None:
            fn(job_id, token)
            return
        fields: dict[str, object] = {"job_id": str(job_id)}
        session_id = None
        try:
            with session_factory()() as db:
                job = get_job(db, job_id)
                fields.update(kind=job.kind, status=job.status)
                for key in ("session_id", "batch_id", "row_id", "provider_mode", "prompt_version"):
                    if key in job.input_snapshot:
                        fields[key] = job.input_snapshot[key]
                if job.retry_of_job_id:
                    fields["retry_of_job_id"] = str(job.retry_of_job_id)
                session_id = str(fields["session_id"]) if fields.get("session_id") else None
        except Exception:
            warning("TASK_METADATA_UNAVAILABLE")
        with (
            session(session_id),
            observation("wardrobe.job", fields=fields, job_id=str(job_id)) as task,
        ):
            try:
                with observation("worker.execute"):
                    fn(job_id, token)
            finally:
                try:
                    final = read_job(job_id)
                    failed_steps = getattr(final.result, "failed_steps", 0)
                    task.update(
                        fields={"status": final.status, "failed_steps": failed_steps},
                        level="ERROR"
                        if final.status in {"failed", "interrupted"}
                        else "WARNING"
                        if final.status != "succeeded" or failed_steps
                        else "DEFAULT",
                        code=final.error.code if final.error else None,
                    )
                except Exception:
                    task.update(level="WARNING", code="FINAL_STATE_UNAVAILABLE")
                    warning("TASK_FINAL_STATE_UNAVAILABLE")

    return wrapped
