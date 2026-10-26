from datetime import timedelta
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import delete, select

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import Job, JobEvent, utcnow
from app.db.session import session_factory
from app.services.jobs import append_event, get_job


def sweep() -> None:
    cutoff = utcnow() - timedelta(seconds=get_settings().lease_seconds)
    with session_factory().begin() as db:
        jobs = db.scalars(
            select(Job)
            .where(Job.status.in_(["running", "cancel_requested"]), Job.heartbeat_at < cutoff)
            .with_for_update(skip_locked=True)
        ).all()
        for job in jobs:
            job.status = "cancelled" if job.status == "cancel_requested" else "interrupted"
            job.lease_token = None
            job.error = {"code": "WORKER_INTERRUPTED", "message": "任务进程中断，请显式重试"}
            append_event(db, job, "error", job.error)
            append_event(db, job, "status", {"status": job.status})
        expiry = utcnow() - timedelta(days=get_settings().event_retention_days)
        db.execute(delete(JobEvent).where(JobEvent.occurred_at < expiry))


def claim() -> tuple[UUID, UUID] | None:
    with session_factory().begin() as db:
        job = db.scalar(
            select(Job)
            .where(Job.status == "queued")
            .order_by(Job.created_at, Job.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if job is None:
            return None
        token = uuid4()
        job.status, job.lease_token, job.heartbeat_at = "running", token, utcnow()
        job.attempt += 1
        append_event(db, job, "status", {"status": "running"})
        return job.id, token


def heartbeat(job_id: UUID, token: UUID) -> bool:
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        if job.lease_token != token or job.status not in {"running", "cancel_requested"}:
            return False
        cutoff = utcnow() - timedelta(seconds=get_settings().lease_seconds)
        if job.heartbeat_at is None or job.heartbeat_at < cutoff:
            return False
        job.heartbeat_at = utcnow()
        return True


def check_lease(job: Job, token: UUID) -> None:
    cutoff = utcnow() - timedelta(seconds=get_settings().lease_seconds)
    if (
        job.lease_token != token
        or job.status != "running"
        or job.heartbeat_at is None
        or job.heartbeat_at < cutoff
    ):
        raise AppError("LEASE_LOST", "任务已取消或执行租约失效")


def complete(
    job_id: UUID,
    token: UUID,
    result: dict[str, JsonValue] | None = None,
    error: dict[str, JsonValue] | None = None,
) -> None:
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        if job.lease_token != token or job.status not in {"running", "cancel_requested"}:
            return
        cutoff = utcnow() - timedelta(seconds=get_settings().lease_seconds)
        if job.heartbeat_at is None or job.heartbeat_at < cutoff:
            return
        if job.status == "cancel_requested":
            job.status = "cancelled"
        elif error is not None:
            job.status = "interrupted" if error.get("code") == "CALL_RESULT_UNKNOWN" else "failed"
            job.error = error
            append_event(db, job, "error", error)
        else:
            job.status, job.result = "succeeded", result
            append_event(db, job, "result", result or {})
        job.lease_token = None
        append_event(db, job, "status", {"status": job.status})
