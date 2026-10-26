from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import Job
from app.db.outfits import OutfitMessage, OutfitSession
from app.db.session import session_factory
from app.schemas.jobs import JobAccepted
from app.schemas.outfits import AdjustInput, GenerateInput
from app.schemas.profile import Requirements
from app.services.jobs import append_event, get_job
from app.services.operations import receipt, save_receipt
from app.services.outfits.sessions import (
    check_idle,
    check_tags,
    get_revision,
    get_session,
    invalid_ids,
)


def constraints(db: Session, row: OutfitSession, payload: GenerateInput) -> None:
    if invalid_ids(db, row.locked_garment_ids):
        raise AppError("CONSTRAINT_CONFLICT", "锁定衣服已不可用或删除，请解锁、恢复或替换")
    if isinstance(payload, AdjustInput):
        if payload.base_revision_id != row.selected_revision_id:
            raise AppError("VERSION_CONFLICT", "请基于当前选中的方案调整")
        base = get_revision(db, payload.base_revision_id)
        targets = set(map(str, payload.target_item_ids))
        items = {str(i["item_id"]): i for i in base.items}
        if not targets <= items.keys():
            raise AppError("INVALID_TARGET", "替换目标不属于此版本", 422)
        if any(str(items[i]["garment_id"]) in row.locked_garment_ids for i in targets):
            raise AppError("CONSTRAINT_CONFLICT", "替换目标已锁定，请先解锁")
        if payload.scope == "replace_items":
            preserved = [
                str(i["garment_id"])
                for k, i in items.items()
                if k not in targets and i["source"] == "wardrobe"
            ]
            if invalid_ids(db, preserved):
                raise AppError("CONSTRAINT_CONFLICT", "需保持的非目标衣服已失效，请调整替换范围")


def submit(
    session_id: UUID, payload: GenerateInput, key: str, retry_of: UUID | None = None
) -> JobAccepted:
    kind = "outfit_adjust" if isinstance(payload, AdjustInput) else "outfit_generate"
    operation = f"outfit-retry:{retry_of}" if retry_of else f"{kind}:{session_id}"
    with session_factory().begin() as db:
        content = {"session_id": str(session_id), **payload.model_dump(mode="json")}
        digest, old = receipt(
            db, operation, key, {"retry_of": str(retry_of)} if retry_of else content
        )
        if old:
            return JobAccepted.model_validate(old.response)
        row = get_session(db, session_id, lock=True)
        check_idle(db, row, payload.expected_version)
        check_tags(db, Requirements.model_validate(row.requirements))
        constraints(db, row, payload)
        settings = get_settings()
        if settings.provider_mode == "disabled" or (
            settings.provider_mode == "qwen" and not settings.qwen_configured
        ):
            raise AppError("PROVIDER_NOT_CONFIGURED", "搭配模型未配置；衣橱仍可手动使用", 503)
        if retry_of and get_job(db, retry_of).status not in {"failed", "interrupted"}:
            raise AppError("RETRY_NOT_ALLOWED", "仅可重试失败或中断的搭配任务")
        job = Job(
            id=uuid4(),
            owner_id=row.owner_id,
            kind=kind,
            operation=operation,
            idempotency_key=key,
            request_hash=digest,
            input_snapshot={
                **content,
                "requirements": row.requirements,
                "locked_garment_ids": row.locked_garment_ids,
                "base_revision_id": str(row.selected_revision_id)
                if row.selected_revision_id
                else None,
                "provider_mode": settings.provider_mode,
                "model": settings.qwen_model,
                "prompt_version": "outfits-v1",
            },
            retry_of_job_id=retry_of,
            status="queued",
            last_seq=0,
        )
        db.add(job)
        db.flush()
        row.current_job_id = job.id
        row.version += 1
        message = (
            payload.message
            if isinstance(payload, AdjustInput)
            else str(row.requirements.get("notes") or "生成今日穿搭")
        )
        db.add(
            OutfitMessage(
                session_id=row.id,
                role="user",
                content=message or "按所选范围调整搭配",
                job_id=job.id,
            )
        )
        append_event(db, job, "status", {"status": "queued"})
        result = JobAccepted(job_id=job.id, status="queued")
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result


def retry_outfit(job_id: UUID, key: str) -> JobAccepted:
    with session_factory()() as db:
        old = get_job(db, job_id)
        session_id = UUID(str(old.input_snapshot["session_id"]))
        row = get_session(db, session_id)
        if old.kind == "outfit_adjust":
            payload: GenerateInput = AdjustInput.model_validate(
                {k: v for k, v in old.input_snapshot.items() if k in AdjustInput.model_fields}
                | {"expected_version": row.version}
            )
        else:
            payload = GenerateInput(expected_version=row.version)
    return submit(session_id, payload, key, retry_of=job_id)
