from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import Job, utcnow
from app.db.session import session_factory
from app.db.travel import TravelRevision
from app.db.wardrobe import Garment
from app.providers.travel import PROMPT_VERSION
from app.schemas.jobs import JobAccepted
from app.schemas.travel import TravelGenerate, TravelInput
from app.services.garment_state import eligible_filter
from app.services.jobs import append_event
from app.services.operations import receipt, save_receipt
from app.services.profile import profile
from app.services.travel.plans import check, require


def submit(plan_id: UUID, payload: TravelGenerate, key: str) -> JobAccepted:
    with session_factory().begin() as db:
        operation = f"travel-generate:{plan_id}"
        digest, old = receipt(db, operation, key, payload.model_dump(mode="json"))
        if old:
            return JobAccepted.model_validate(old.response)
        row = require(db, plan_id, True)
        check(row, payload.expected_version, db)
        request = TravelInput.model_validate(row.draft)
        settings = get_settings()
        if settings.provider_mode == "disabled" or (
            settings.provider_mode == "qwen" and not settings.qwen_configured
        ):
            raise AppError("PROVIDER_NOT_CONFIGURED", "请先配置搭配模型", 503)
        garments = list(
            db.scalars(select(Garment).where(*eligible_filter()).order_by(Garment.id).limit(501))
        )
        if len(garments) > 500:
            raise AppError("CANDIDATE_LIMIT", "可用衣橱超过 500 件，请先缩小范围", 422)
        ids = {g.id for g in garments}
        if not set(request.required_garment_ids) <= ids:
            raise AppError("CONSTRAINT_CONFLICT", "必带单品已不可用、删除或退出，请编辑计划处理")
        base = db.get(TravelRevision, row.current_revision_id) if row.current_revision_id else None
        preserved = {}
        if payload.adjust_date:
            if not base or base.request != row.draft:
                raise AppError("CONSTRAINT_CONFLICT", "条件已变或尚无方案，请先生成完整计划")
            if payload.adjust_date not in {d.date for d in request.days}:
                raise AppError("INVALID_TARGET", "调整日期不属于行程", 422)
            preserved = {
                str(d["date"]): d for d in base.days if d["date"] != str(payload.adjust_date)
            }
        job = Job(
            id=uuid4(),
            owner_id=row.owner_id,
            operation=operation,
            idempotency_key=key,
            request_hash=digest,
            kind="travel_generate",
            input_snapshot={
                "travel_id": str(row.id),
                "request": row.draft,
                "preserved": preserved,
                "message": payload.message,
                "adjust_date": str(payload.adjust_date) if payload.adjust_date else None,
                "candidates": {str(g.id): g.attributes for g in garments},
                "candidate_versions": {str(g.id): g.version for g in garments},
                "preferences": profile(db).preferences,
                "provider_mode": settings.provider_mode,
                "model": settings.qwen_model,
                "prompt_version": PROMPT_VERSION,
                "deadline": (utcnow() + timedelta(seconds=300)).isoformat(),
            },
        )
        db.add(job)
        db.flush()
        row.current_job_id = job.id
        row.version += 1
        append_event(db, job, "status", {"status": "queued"})
        result = JobAccepted(job_id=job.id, status="queued")
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result
