import secrets
from pathlib import Path
from uuid import UUID

from app.backup import archive, control, database
from app.core.errors import AppError
from app.db.models import utcnow
from app.schemas.backups import RestoreApply, RestoreView
from app.schemas.jobs import JobAccepted


def create(key: str) -> JobAccepted:
    with control.registry():
        for old in control.all_records():
            if old.kind == "backup_export" and old.key == key:
                return JobAccepted(job_id=old.id, status=control.job(old).status)
        record = control.Control(kind="backup_export", key=key)
        control.event(record, "status", {"status": "queued"})
    return JobAccepted(job_id=record.id, status="queued")


def accept_upload(path: Path, key: str) -> RestoreView:
    digest = archive.sha256(path)
    with control.registry():
        for old in control.all_records():
            if old.kind == "backup_restore" and old.key == key:
                if old.request_hash != digest:
                    raise AppError("IDEMPOTENCY_CONFLICT", "该操作键已用于其他备份")
                return restore_view(old.id)
        record = control.Control(
            kind="backup_restore",
            key=key,
            request_hash=digest,
            status="validating",
            phase="uploaded",
            message="等待隔离验证",
        )
        path.replace(control.directory(record.id) / "input.zip")
        control.save(record)
    return restore_view(record.id)


def restore_view(restore_id: UUID) -> RestoreView:
    record = control.require(restore_id, "backup_restore")
    expired = record.status == "ready" and record.expires_at and record.expires_at <= utcnow()
    return RestoreView.model_validate(
        dict(
            restore_id=record.id,
            status="expired" if expired else record.status,
            message=record.message,
            sha256=record.sha256,
            confirmation_token=record.token if record.status == "ready" and not expired else None,
            expires_at=record.expires_at,
            target_data_epoch=record.epoch,
            summary=record.summary,
            job_id=record.id if record.apply_key else None,
        )
    )


def apply(restore_id: UUID, payload: RestoreApply, key: str) -> JobAccepted:
    with control.registry():
        record = control.require(restore_id, "backup_restore")
        digest = control.digest(payload.model_dump_json().encode())
        if record.apply_key:
            if record.apply_key != key or record.apply_hash != digest:
                raise AppError("IDEMPOTENCY_CONFLICT", "恢复已确认，不能创建第二次覆盖")
            return JobAccepted(job_id=record.id, status=control.job(record).status)
        if (
            record.status != "ready"
            or not record.token
            or not secrets.compare_digest(record.token, payload.confirmation_token)
        ):
            raise AppError("RESTORE_NOT_READY", "验证未通过或确认令牌无效")
        if (
            not record.expires_at
            or record.expires_at <= utcnow()
            or record.epoch != database.data_epoch()
        ):
            raise AppError("RESTORE_EXPIRED", "确认已过期或目标数据已恢复，请重新验证")
        record.apply_key, record.apply_hash = key, digest
        record.status, record.phase, record.message = "queued", "confirmed", "已确认，等待维护窗口"
        control.event(record, "status", {"status": "queued"})
    return JobAccepted(job_id=record.id, status="queued")


def download(backup_id: UUID) -> Path:
    record = control.require(backup_id, "backup_export")
    if record.status != "succeeded" or not record.expires_at or record.expires_at <= utcnow():
        raise AppError("BACKUP_NOT_AVAILABLE", "备份未完成或下载已过期", 410)
    path = control.directory(backup_id) / "backup.zip"
    if not path.is_file():
        raise AppError("BACKUP_MISSING", "备份文件缺失", 404)
    return path
