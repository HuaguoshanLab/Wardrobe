from uuid import UUID

from pydantic import JsonValue, ValidationError
from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.session import session_factory
from app.db.wardrobe import ImportBatch, ImportRow, MediaAsset
from app.jobs.queue import check_lease
from app.media.excel import parse_excel
from app.media.images import cutout, normalize
from app.media.storage import path_for, store_bytes
from app.providers.recognition import recognize
from app.schemas.wardrobe import Attributes
from app.services.import_review import read_batch
from app.services.jobs import append_event, get_job
from app.services.operations import owner_id
from app.services.wardrobe import get_or_create_tag


def parse_batch(job_id: UUID, token: UUID, batch_id: UUID) -> None:
    with session_factory()() as db:
        batch = db.get(ImportBatch, batch_id)
        assert batch
        if db.scalar(select(ImportRow.id).where(ImportRow.batch_id == batch_id).limit(1)):
            return
        source_key = batch.source_key
    if not source_key:
        return
    parsed = parse_excel(path_for(source_key).read_bytes())
    # Files are immutable; orphan files after a crash are retained conservatively.
    with session_factory().begin() as db:
        check_lease(get_job(db, job_id, lock=True), token)
        for item in parsed:
            media = None
            if item.image:
                key, sha = store_bytes(item.image)
                media = MediaAsset(
                    owner_id=owner_id(db),
                    original_key=key,
                    original_name=f"Excel-row-{item.number}.png",
                    sha256=sha,
                )
                db.add(media)
                db.flush()
            attrs = Attributes().model_dump(mode="json")
            errors: dict[str, JsonValue] = {}
            for field, value in item.attributes.items():
                try:
                    attrs = Attributes.model_validate({**attrs, field: value}).model_dump(
                        mode="json"
                    )
                except ValidationError:
                    errors[field] = f"{field} 字段不合法，请在表格中补充"
            try:
                attrs["custom_tag_ids"] = [
                    str(get_or_create_tag(db, name).id) for name in item.tags
                ]
            except AppError as exc:
                errors["custom_tag_ids"] = exc.message
            if item.errors:
                errors["structure"] = "；".join(item.errors)
            db.add(
                ImportRow(
                    batch_id=batch_id,
                    row_number=item.number,
                    filename=f"Excel 第 {item.number} 行",
                    image_asset_id=media.id if media else None,
                    draft=attrs,
                    errors=errors,
                    conversion_status="queued" if media else "failed",
                    cutout_status="queued" if media else "not_requested",
                    step_jobs={step: str(job_id) for step in ["conversion", "cutout"]},
                )
            )


def run_step(job_id: UUID, token: UUID, row_id: UUID, step: str) -> None:
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        row = db.scalar(select(ImportRow).where(ImportRow.id == row_id).with_for_update())
        assert row
        if row.skipped or row.confirmed_garment_id and step == "analysis":
            setattr(row, f"{step}_status", "cancelled")
            return
        if not row.image_asset_id:
            return
        media = db.get(MediaAsset, row.image_asset_id)
        assert media
        if step != "conversion" and not media.display_key:
            setattr(row, f"{step}_status", "failed")
            row.errors = {**row.errors, step: "请先修复图片转换"}
            return
        original, display = media.original_key, media.display_key
        setattr(row, f"{step}_status", "running")
        row.step_jobs = {**row.step_jobs, step: str(job_id)}
        row.version += 1
        append_event(db, job, "progress", {"row_id": str(row.id), "step": step})
    result: dict[str, JsonValue] = {}
    error: str | None = None
    source: str | None = None
    try:
        if step == "conversion":
            data, width, height = normalize(path_for(original).read_bytes())
            key, _ = store_bytes(data, "display")
            result = {"key": key, "width": width, "height": height}
        elif step == "cutout":
            if not get_settings().cutout_enabled:
                raise AppError("CUTOUT_DISABLED", "去背景未启用，可使用原图", 503)
            assert display
            key, _ = store_bytes(cutout(path_for(display).read_bytes()), "cutout")
            result = {"key": key}
        elif step == "analysis":
            assert display
            result, source = recognize(path_for(display).read_bytes())
            result = Attributes.model_validate(result).model_dump(mode="json", exclude_unset=True)
    except AppError as exc:
        error = f"{exc.code}: {exc.message}"
    except Exception:
        error = f"{step.upper()}_FAILED: 处理失败，可重试或使用原图/人工填写"
    with session_factory().begin() as db:
        check_lease(get_job(db, job_id, lock=True), token)
        row = db.scalar(select(ImportRow).where(ImportRow.id == row_id).with_for_update())
        assert row
        if row.skipped:
            setattr(row, f"{step}_status", "cancelled")
            return
        media = db.get(MediaAsset, row.image_asset_id)
        assert media
        row.errors = {k: v for k, v in row.errors.items() if k != step}
        setattr(row, f"{step}_status", "failed" if error else "succeeded")
        if error:
            row.errors = {**row.errors, step: error}
        elif step == "conversion":
            media.display_key, media.width, media.height = (
                str(result["key"]),
                int(str(result["width"])),
                int(str(result["height"])),
            )
        elif step == "cutout":
            media.cutout_key = str(result["key"])
            if not row.confirmed_garment_id and "display_variant" not in row.touched_fields:
                row.draft = {**row.draft, "display_variant": "cutout"}
        elif step == "analysis":
            row.analysis_source = source
            if not row.confirmed_garment_id:
                row.draft = {
                    **row.draft,
                    **{
                        k: v
                        for k, v in result.items()
                        if k not in row.touched_fields and not row.draft.get(k)
                    },
                }
        row.version += 1


def execute_import(job_id: UUID, token: UUID) -> dict[str, JsonValue]:
    with session_factory()() as db:
        job = get_job(db, job_id)
        inputs, kind = job.input_snapshot, job.kind
    if kind.startswith("import_"):
        batch_id = UUID(str(inputs["batch_id"]))
        if kind == "import_excel":
            parse_batch(job_id, token, batch_id)
        with session_factory()() as db:
            row_ids = list(
                db.scalars(
                    select(ImportRow.id)
                    .where(ImportRow.batch_id == batch_id)
                    .order_by(ImportRow.row_number)
                )
            )
        for row_id in row_ids:
            for step in (
                ["conversion", "analysis", "cutout"]
                if kind == "import_photos"
                else ["conversion", "cutout"]
            ):
                run_step(job_id, token, row_id, step)
        batch = read_batch(batch_id)
        return {
            "import_batch_id": str(batch_id),
            "row_counts": {
                status: sum(row.row_status == status for row in batch.rows)
                for status in ["ready", "invalid", "confirmed", "skipped"]
            },
            "failed_steps": sum(
                getattr(row, f"{step}_status") == "failed"
                for row in batch.rows
                for step in ("conversion", "analysis", "cutout")
            ),
        }
    row_id, step = UUID(str(inputs["row_id"])), str(inputs["step"])
    run_step(job_id, token, row_id, step)
    with session_factory()() as db:
        row = db.get(ImportRow, row_id)
        assert row
        if getattr(row, f"{step}_status") == "failed":
            raise AppError("STEP_FAILED", str(row.errors.get(step)), 422)
        return {
            "import_row_id": str(row.id),
            "image_asset_id": str(row.image_asset_id),
            "step": step,
            "status": str(getattr(row, f"{step}_status")),
        }
