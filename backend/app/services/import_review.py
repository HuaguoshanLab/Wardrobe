from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Job
from app.db.session import session_factory
from app.db.wardrobe import Garment, ImportBatch, ImportRow
from app.domain.taxonomy import attribute_errors
from app.schemas.wardrobe import (
    Attributes,
    BatchView,
    Confirmation,
    ConfirmInput,
    ConfirmOutcome,
    RowPatch,
    RowView,
)
from app.services.operations import owner_id, receipt, save_receipt
from app.services.wardrobe import asset, image_url, validate_attributes


def find_batch(db: Session, batch_id: UUID) -> ImportBatch:
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise AppError("NOT_FOUND", "导入批次不存在", 404)
    return batch


def find_row(db: Session, batch_id: UUID, row_id: UUID, *, lock: bool = False) -> ImportRow:
    query = select(ImportRow).where(ImportRow.batch_id == batch_id, ImportRow.id == row_id)
    if lock:
        query = query.with_for_update()
    row = db.scalar(query)
    if row is None:
        raise AppError("NOT_FOUND", "审核行不存在", 404)
    return row


def view_row(db: Session, row: ImportRow) -> RowView:
    attrs = Attributes.model_validate(row.draft)
    media = asset(db, row.image_asset_id) if row.image_asset_id else None
    errors = (
        validate_attributes(db, attrs, media)
        if media
        else ["图片必填", *attribute_errors(attrs.model_dump())]
    )
    if row.errors.get("structure"):
        errors.append(str(row.errors["structure"]))
    errors.extend(str(value) for key, value in row.errors.items() if key in Attributes.model_fields)
    status: Literal["confirmed", "skipped", "invalid", "ready"] = (
        "confirmed"
        if row.confirmed_garment_id
        else "skipped"
        if row.skipped
        else "invalid"
        if errors
        else "ready"
    )
    steps = {}
    for step in ("conversion", "analysis", "cutout"):
        value = getattr(row, f"{step}_status")
        step_job = db.get(Job, UUID(str(row.step_jobs[step]))) if row.step_jobs.get(step) else None
        if (
            value in ("queued", "running")
            and step_job
            and step_job.status in ("failed", "interrupted", "cancelled")
        ):
            value = step_job.status
        steps[step] = value
    return RowView(
        id=row.id,
        row_number=row.row_number,
        filename=row.filename,
        image_asset_id=row.image_asset_id,
        image_url=image_url(media, attrs.display_variant) if media else None,
        has_cutout=bool(media and media.cutout_key),
        draft=attrs,
        version=row.version,
        touched_fields=row.touched_fields,
        validation_errors=errors,
        processing_errors=row.errors,
        row_status=status,
        conversion_status=steps["conversion"],
        analysis_status=steps["analysis"],
        cutout_status=steps["cutout"],
        analysis_source=row.analysis_source,
        confirmed_garment_id=row.confirmed_garment_id,
    )


def read_batch(batch_id: UUID) -> BatchView:
    with session_factory()() as db:
        batch = find_batch(db, batch_id)
        job = db.get(Job, batch.parent_job_id)
        assert job
        rows = db.scalars(
            select(ImportRow).where(ImportRow.batch_id == batch_id).order_by(ImportRow.row_number)
        ).all()
        return BatchView(
            id=batch.id,
            source=batch.source,
            parent_job_id=job.id,
            job_status=job.status,
            job_error=str(job.error.get("message")) if job.error else None,
            rows=[view_row(db, row) for row in rows],
        )


def patch_row(batch_id: UUID, row_id: UUID, patch: RowPatch) -> RowView:
    with session_factory().begin() as db:
        row = find_row(db, batch_id, row_id, lock=True)
        if row.confirmed_garment_id or row.skipped:
            raise AppError("ROW_FINALIZED", "该行已确认或已移除")
        if row.version != patch.expected_version:
            raise AppError("VERSION_CONFLICT", "审核行已更新，请保留草稿并重新读取")
        row.draft = Attributes.model_validate({**row.draft, **patch.changes}).model_dump(
            mode="json"
        )
        row.touched_fields = sorted(set(row.touched_fields) | set(patch.changes))
        row.errors = {k: v for k, v in row.errors.items() if k not in patch.changes}
        row.skipped = patch.skip
        row.version += 1
        db.flush()
        return view_row(db, row)


def confirm(batch_id: UUID, payload: ConfirmInput, key: str) -> Confirmation:
    operation = f"confirm:{batch_id}"
    with session_factory().begin() as db:
        find_batch(db, batch_id)
        digest, old = receipt(db, operation, key, payload.model_dump(mode="json"))
        if old:
            return Confirmation.model_validate(old.response)
        outcomes: list[ConfirmOutcome] = []
        for item in sorted(payload.rows, key=lambda item: str(item.row_id)):
            with db.begin_nested():
                try:
                    row = find_row(db, batch_id, item.row_id, lock=True)
                except AppError:
                    outcomes.append(
                        ConfirmOutcome(
                            row_id=item.row_id, status="invalid", errors=["审核行不存在"]
                        )
                    )
                    continue
                result = ConfirmOutcome(row_id=row.id, status="invalid")
                if row.confirmed_garment_id:
                    result.status, result.garment_id = "already_confirmed", row.confirmed_garment_id
                elif row.version != item.expected_version:
                    result.status = "version_conflict"
                else:
                    view = view_row(db, row)
                    if view.row_status != "ready":
                        result.errors = view.validation_errors or ["该行已移除"]
                    else:
                        garment = Garment(
                            owner_id=owner_id(db),
                            image_asset_id=row.image_asset_id,
                            attributes=row.draft,
                        )
                        db.add(garment)
                        db.flush()
                        row.confirmed_garment_id = garment.id
                        row.version += 1
                        result.status, result.garment_id = "confirmed", garment.id
                outcomes.append(result)
        response = Confirmation(rows=outcomes)
        save_receipt(db, operation, key, digest, response.model_dump(mode="json"))
        return response
