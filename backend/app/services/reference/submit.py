from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import Job, utcnow
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.providers.reference import PROMPT_VERSION
from app.schemas.jobs import JobAccepted
from app.schemas.reference import ReferenceVersion
from app.services.garment_state import eligible_filter
from app.services.jobs import append_event
from app.services.operations import receipt, save_receipt
from app.services.profile import profile
from app.services.reference.records import check, require


def submit(ref_id: UUID, payload: ReferenceVersion, key: str, action: str) -> JobAccepted:
    with session_factory().begin() as db:
        op = f"reference-{action}:{ref_id}"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return JobAccepted.model_validate(old.response)
        row = require(db, ref_id, True)
        check(db, row, payload.expected_version)
        settings = get_settings()
        mode = settings.recognition_mode if action == "analyze" else settings.provider_mode
        if mode == "disabled" or (mode == "qwen" and not settings.qwen_configured):
            raise AppError("PROVIDER_NOT_CONFIGURED", "请先配置图片分析或搭配服务", 503)
        if action == "generate" and (not row.confirmed or not row.clues):
            raise AppError("CLUES_REQUIRED", "请先确认至少一条参考线索", 422)
        garments = (
            list(
                db.scalars(
                    select(Garment).where(*eligible_filter()).order_by(Garment.id).limit(501)
                )
            )
            if action == "generate"
            else []
        )
        if len(garments) > 500:
            raise AppError("CANDIDATE_LIMIT", "可用衣橱超过500件，请先缩小范围", 422)
        job = Job(
            id=uuid4(),
            owner_id=row.owner_id,
            kind=f"reference_{action}",
            operation=op,
            idempotency_key=key,
            request_hash=digest,
            input_snapshot={
                "reference_id": str(row.id),
                "action": action,
                "display_key": row.display_key,
                "clues": row.clues,
                "provider_mode": mode,
                "model": settings.qwen_model,
                "prompt_version": PROMPT_VERSION,
                "deadline": (utcnow() + timedelta(seconds=300)).isoformat(),
                "candidates": {str(g.id): g.attributes for g in garments},
                "candidate_versions": {str(g.id): g.version for g in garments},
                "preferences": profile(db).preferences if action == "generate" else {},
            },
        )
        db.add(job)
        db.flush()
        row.current_job_id = job.id
        row.version += 1
        append_event(db, job, "status", {"status": "queued"})
        result = JobAccepted(job_id=job.id, status="queued")
        save_receipt(db, op, key, digest, result.model_dump(mode="json"))
        return result
