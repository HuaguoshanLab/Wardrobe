from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Job
from app.db.session import session_factory
from app.db.wardrobe import ImportBatch, ImportRow, MediaAsset
from app.schemas.jobs import TERMINAL
from app.schemas.wardrobe import Attributes, ImportAccepted
from app.services.import_review import find_row
from app.services.jobs import append_event, get_job
from app.services.operations import owner_id, receipt, save_receipt


def new_job(db: Session, kind: str, payload: dict[str, str], key: str) -> Job:
    job = Job(
        id=uuid4(),
        owner_id=owner_id(db),
        operation=kind,
        idempotency_key=key,
        request_hash=key,
        kind=kind,
        input_snapshot=payload,
    )
    db.add(job)
    db.flush()
    append_event(db, job, "status", {"status": "queued"})
    return job


def submit_import(
    source: str, files: list[dict[str, str]], key: str
) -> tuple[ImportAccepted, bool]:
    with session_factory().begin() as db:
        digest, old = receipt(
            db, f"upload:{source}", key, [{"sha256": f["sha256"], "name": f["name"]} for f in files]
        )
        if old:
            return ImportAccepted.model_validate(old.response), False
        batch_id = uuid4()
        job = new_job(db, f"import_{source}", {"batch_id": str(batch_id)}, str(uuid4()))
        batch = ImportBatch(
            id=batch_id,
            owner_id=owner_id(db),
            source=source,
            parent_job_id=job.id,
            source_key=files[0]["key"] if source == "excel" else None,
        )
        db.add(batch)
        db.flush()
        if source == "photos":
            for index, item in enumerate(files, 1):
                media = MediaAsset(
                    owner_id=owner_id(db),
                    original_key=item["key"],
                    original_name=item["name"],
                    sha256=item["sha256"],
                )
                db.add(media)
                db.flush()
                db.add(
                    ImportRow(
                        batch_id=batch_id,
                        row_number=index,
                        filename=item["name"],
                        image_asset_id=media.id,
                        draft=Attributes().model_dump(mode="json"),
                        analysis_status="queued",
                        step_jobs={
                            step: str(job.id) for step in ["conversion", "analysis", "cutout"]
                        },
                    )
                )
        response = ImportAccepted(import_batch_id=batch_id, job_id=job.id, status="queued")
        save_receipt(db, f"upload:{source}", key, digest, response.model_dump(mode="json"))
        return response, True


def retry_step(batch_id: UUID, row_id: UUID, step: str, key: str) -> ImportAccepted:
    with session_factory().begin() as db:
        operation = f"step:{row_id}:{step}"
        digest, old = receipt(db, operation, key, {"step": step})
        if old:
            return ImportAccepted.model_validate(old.response)
        row = find_row(db, batch_id, row_id, lock=True)
        if row.skipped or row.confirmed_garment_id:
            raise AppError("ROW_FINALIZED", "已确认或移除行不能重新处理")
        if row.image_asset_id is None:
            raise AppError("IMAGE_REQUIRED", "请修正源 Excel 的图片后重新导入", 422)
        old_id = row.step_jobs.get(step)
        if old_id and get_job(db, UUID(str(old_id))).status not in TERMINAL:
            raise AppError("JOB_ACTIVE", "该步骤仍在处理，请等待完成或先取消")
        media = db.get(MediaAsset, row.image_asset_id)
        if step != "conversion" and (media is None or not media.display_key):
            raise AppError("IMAGE_NOT_READY", "请先重试图片转换", 422)
        kinds = {
            "conversion": "media_convert",
            "analysis": "garment_recognize",
            "cutout": "media_cutout",
        }
        job = new_job(db, kinds[step], {"row_id": str(row_id), "step": step}, str(uuid4()))
        row.step_jobs = {**row.step_jobs, step: str(job.id)}
        setattr(row, f"{step}_status", "queued")
        row.version += 1
        response = ImportAccepted(import_batch_id=batch_id, job_id=job.id, status="queued")
        save_receipt(db, operation, key, digest, response.model_dump(mode="json"))
        return response
