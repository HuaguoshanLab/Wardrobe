import hashlib
import json
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.backup import control
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import Job, JobEvent, SystemState, utcnow
from app.db.session import session_factory
from app.schemas.jobs import TERMINAL, DiagnosticInput, EventView, JobView


def append_event(db: Session, job: Job, kind: str, payload: dict[str, JsonValue]) -> None:
    job.last_seq += 1
    job.updated_at = utcnow()
    db.add(JobEvent(job_id=job.id, seq=job.last_seq, type=kind, payload=payload))


def get_job(db: Session, job_id: UUID, *, lock: bool = False) -> Job:
    stmt = select(Job).where(Job.id == job_id)
    if lock:
        stmt = stmt.with_for_update()
    job = db.scalar(stmt)
    if job is None:
        raise AppError("NOT_FOUND", "任务不存在", 404)
    return job


def read_job(job_id: UUID) -> JobView:
    if record := control.read(job_id):
        return control.job(record)
    with session_factory()() as db:
        return JobView.model_validate(get_job(db, job_id))


def create_job(payload: DiagnosticInput, key: str, retry_of: UUID | None = None) -> JobView:
    if get_settings().provider_mode != "fake":
        raise AppError("PROVIDER_NOT_CONFIGURED", "请显式启用 Fake Provider 后再运行诊断", 503)
    content = payload.model_dump(mode="json")
    digest = hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()
    operation = f"retry:{retry_of}" if retry_of else "diagnostic"
    with session_factory().begin() as db:
        owner = db.scalar(select(SystemState.owner_id).where(SystemState.id == 1))
        if owner is None:
            raise AppError("NOT_INITIALIZED", "请先运行初始化迁移", 503)
        existing = db.scalar(
            select(Job).where(
                Job.owner_id == owner, Job.operation == operation, Job.idempotency_key == key
            )
        )
        if existing:
            if existing.request_hash != digest:
                raise AppError("IDEMPOTENCY_CONFLICT", "同一操作键不能用于不同内容")
            return JobView.model_validate(existing)
        if retry_of:
            old = get_job(db, retry_of, lock=True)
            if old.status not in {"failed", "interrupted"}:
                raise AppError("RETRY_NOT_ALLOWED", "只能显式重试失败或中断的诊断任务")
        new_id = uuid4()
        created = db.scalar(
            insert(Job)
            .values(
                id=new_id,
                owner_id=owner,
                operation=operation,
                idempotency_key=key,
                request_hash=digest,
                input_snapshot=content,
                retry_of_job_id=retry_of,
            )
            .on_conflict_do_nothing()
            .returning(Job.id)
        )
        job = db.scalar(
            select(Job).where(
                Job.owner_id == owner, Job.operation == operation, Job.idempotency_key == key
            )
        )
        assert job is not None
        if job.request_hash != digest:
            raise AppError("IDEMPOTENCY_CONFLICT", "同一操作键不能用于不同内容")
        if created:
            append_event(db, job, "status", {"status": "queued"})
            db.flush()
        return JobView.model_validate(job)


def retry_job(job_id: UUID, key: str) -> JobView:
    if control.read(job_id):
        raise AppError("CONTROL_RETRY_UNSUPPORTED", "维护任务请重新创建备份或重新验证恢复")
    with session_factory()() as db:
        original = get_job(db, job_id)
        if original.kind in {"outfit_generate", "outfit_adjust"}:
            from app.services.outfits.submit import retry_outfit

            accepted = retry_outfit(job_id, key)
            return read_job(accepted.job_id)
        if original.kind != "diagnostic":
            raise AppError(
                "USE_ROW_RETRY", "请在导入审核中重试对应行；Excel 整文件失败请修正后重新导入"
            )
        payload = DiagnosticInput.model_validate(original.input_snapshot)
    return create_job(payload, key, retry_of=job_id)


def cancel_job(job_id: UUID) -> JobView:
    if control.read(job_id):
        raise AppError("CONTROL_CANCEL_UNSUPPORTED", "维护切换不能中途取消，请等待终态")
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        if job.status == "queued":
            job.status = "cancelled"
            append_event(db, job, "status", {"status": job.status})
        elif job.status == "running":
            job.status = "cancel_requested"
            append_event(db, job, "status", {"status": job.status})
        db.flush()
        return JobView.model_validate(job)


def read_events(job_id: UUID, after: int) -> tuple[list[EventView], bool]:
    if record := control.read(job_id):
        control.job(record)  # Validation is not a restore Job until explicitly applied.
        if after > len(record.events):
            raise AppError("INVALID_EVENT_CURSOR", "事件游标超出任务范围", 422)
        events = record.events[after : after + 100]
        return events, record.status in TERMINAL and after + len(events) == len(record.events)
    with session_factory()() as db:
        job = get_job(db, job_id)
        if after > job.last_seq:
            raise AppError("INVALID_EVENT_CURSOR", "事件游标超出任务范围", 422)
        rows = db.scalars(
            select(JobEvent)
            .where(JobEvent.job_id == job_id, JobEvent.seq > after)
            .order_by(JobEvent.seq)
            .limit(100)
        ).all()
        if after < job.last_seq and (not rows or rows[0].seq != after + 1):
            raise AppError("EVENT_CURSOR_EXPIRED", "事件已过期，请重新查询任务结果", 410)
        events = [EventView.model_validate(row) for row in rows]
        done = job.status in TERMINAL and (not rows or rows[-1].seq == job.last_seq)
        return events, done
