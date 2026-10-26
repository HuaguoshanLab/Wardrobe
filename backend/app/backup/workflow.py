from datetime import timedelta
from uuid import uuid4

import psycopg

from app.backup import archive, control, database
from app.core.errors import AppError
from app.core.maintenance import exclusive
from app.db.models import utcnow
from app.schemas.backups import BackupResult
from app.schemas.common import ErrorDetail


def finish(record: control.Control, result: BackupResult) -> None:
    record.result, record.status, record.phase = result, "succeeded", "complete"
    record.message = "备份已完成" if record.kind == "backup_export" else "恢复已完成，请重新载入"
    control.event(record, "result", result.model_dump(mode="json"))
    control.event(record, "status", {"status": "succeeded"})


def restored(record: control.Control) -> BackupResult:
    return BackupResult(
        restore_id=record.id,
        data_epoch=record.new_epoch,
        refresh_required=True,
        summary=record.summary,
    )


def fail(record: control.Control, exc: Exception) -> None:
    record.status = "invalid" if record.phase == "validating" else "failed"
    record.message = (
        exc.message if isinstance(exc, AppError) else "维护操作失败；未确认成功，请查看任务状态"
    )
    record.error = ErrorDetail(
        code=exc.code if isinstance(exc, AppError) else "BACKUP_FAILED", message=record.message
    )
    control.event(record, "error", record.error.model_dump(mode="json"))
    if record.status == "failed":
        control.event(record, "status", {"status": "failed"})
    else:
        control.save(record)


def validate(record: control.Control) -> None:
    directory = control.directory(record.id)
    record.phase = "validating"
    record.stage_database = "wardrobe_restore_" + uuid4().hex
    control.save(record)
    data, summary = archive.validate_archive(directory / "input.zip", directory / "validated")
    with database.staging(record.stage_database, directory) as url:
        with psycopg.connect(url) as connection:
            database.import_data(connection, data)
    record.sha256 = archive.sha256(directory / "input.zip")
    record.summary, record.epoch = summary, database.data_epoch()
    record.token, record.expires_at = uuid4().hex + uuid4().hex, utcnow() + timedelta(minutes=30)
    record.status, record.phase, record.message = (
        "ready",
        "validated",
        "验证通过；确认后将覆盖当前业务数据",
    )
    control.save(record)


def export(record: control.Control) -> None:
    record.status, record.phase = "running", "quiescing"
    control.event(record, "status", {"status": "running"})
    with exclusive():
        record.phase = "exporting"
        control.event(
            record,
            "progress",
            {"stage": record.phase, "message": "写入已静止，正在导出数据库与图片"},
        )
        path, summary = archive.export_archive(control.directory(record.id))
        record.expires_at = utcnow() + timedelta(days=7)
        finish(
            record,
            BackupResult(
                backup_id=record.id,
                sha256=archive.sha256(path),
                download_url=f"/api/v1/backups/{record.id}/download",
                summary=summary,
            ),
        )


def apply(record: control.Control) -> None:
    record.status, record.phase = "running", "quiescing"
    control.event(record, "status", {"status": "running"})
    with exclusive():
        if (
            record.epoch != database.data_epoch()
            or not record.expires_at
            or record.expires_at <= utcnow()
        ):
            raise AppError("RESTORE_EXPIRED", "目标数据世代已变更或确认已过期，请重新验证")
        directory = control.directory(record.id)
        if archive.sha256(directory / "input.zip") != record.sha256:
            raise AppError("INVALID_BACKUP", "备份在验证后发生变化")
        data, summary = archive.validate_archive(
            directory / "input.zip", directory / "apply-validated"
        )
        # Revalidate rows in a fresh isolated DB immediately before any target mutation.
        record.stage_database = "wardrobe_restore_" + uuid4().hex
        control.save(record)
        with database.staging(record.stage_database, directory) as url:
            with psycopg.connect(url) as connection:
                database.import_data(connection, data)
        record.phase = "recovery_point"
        control.event(
            record, "progress", {"stage": record.phase, "message": "正在保存当前数据库与图片恢复点"}
        )
        archive.export_archive(directory, "recovery.zip")
        record.new_epoch, record.summary = uuid4(), summary
        record.phase = "installing_media"
        control.save(record)
        archive.install_media(directory / "apply-validated", data)
        record.phase = "switching"
        control.event(
            record,
            "progress",
            {"stage": record.phase, "message": "图片已校验，正在事务切换业务与检查点数据"},
        )
        database.switch_data(data, record.new_epoch)
        # Crash here is resolved from the epoch committed in the same DB transaction.
        if database.data_epoch() != record.new_epoch:
            raise AppError("RESTORE_VERIFY_FAILED", "恢复后的数据世代校验失败")
        finish(record, restored(record))


def process(record: control.Control) -> None:
    try:
        if record.kind == "backup_export":
            export(record)
        elif record.status == "validating":
            validate(record)
        else:
            apply(record)
    except Exception as exc:
        if record.new_epoch and database.data_epoch() == record.new_epoch:
            finish(record, restored(record))
        else:
            fail(record, exc)


def recover(record: control.Control) -> None:
    if record.stage_database:
        database.drop_stage(record.stage_database)
    if record.new_epoch and database.data_epoch() == record.new_epoch:
        finish(record, restored(record))
    elif record.status == "validating":
        fail(record, AppError("VALIDATION_INTERRUPTED", "验证进程中断，请重新上传验证"))
    else:
        record.status, record.message = "interrupted", "维护进程中断；数据库事务未切换，原数据保留"
        record.error = ErrorDetail(code="CONTROL_INTERRUPTED", message=record.message)
        control.event(record, "error", record.error.model_dump(mode="json"))
        control.event(record, "status", {"status": "interrupted"})
