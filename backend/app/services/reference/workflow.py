from datetime import datetime
from typing import cast
from uuid import UUID, uuid4

from pydantic import JsonValue, ValidationError
from sqlalchemy import select

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.outfits import OutfitRevision, OutfitSession
from app.db.session import session_factory
from app.db.wardrobe import Garment, Tag
from app.domain.reference import evidence, reviewed_analysis, validate
from app.jobs.queue import check_lease
from app.schemas.outfits import ModelOutfits
from app.schemas.profile import Requirements
from app.schemas.reference import ReferenceAnalysis, ReferenceClue, ReferenceResult
from app.services.garment_state import eligible
from app.services.jobs import append_event, get_job
from app.services.outfits.snapshots import snapshot
from app.services.reference.calls import call
from app.services.reference.records import require


def run(job_id: UUID, token: UUID) -> None:
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        if job.status == "succeeded":
            return
        check_lease(job, token)
        data = dict(job.input_snapshot)
    context = {k: data[k] for k in ("clues", "candidates", "preferences")}
    correction = ""
    for attempt in range(1 if data["action"] == "analyze" else 2):
        try:
            raw = call(job_id, token, attempt, {**context, "correction": correction}, data)
            if data["action"] == "analyze":
                analysis = reviewed_analysis(
                    ReferenceAnalysis.model_validate(raw), str(data["provider_mode"])
                )
                publish(job_id, token, data, analysis=analysis)
            else:
                output = ModelOutfits.model_validate(raw)
                validate(
                    output,
                    cast(dict[str, dict[str, JsonValue]], data["candidates"]),
                    [ReferenceClue.model_validate(c) for c in cast(list[JsonValue], data["clues"])],
                )
                publish(job_id, token, data, output=output)
            return
        except ValidationError as exc:
            correction = "JSON字段或词表无效，请严格核对schema。"
            if data["action"] == "analyze" or attempt == 1:
                raise AppError("INVALID_MODEL_OUTPUT", correction) from exc
        except AppError as exc:
            if exc.code != "INVALID_MODEL_OUTPUT" or data["action"] == "analyze" or attempt == 1:
                raise
            correction = exc.message


def publish(
    job_id: UUID,
    token: UUID,
    data: dict[str, JsonValue],
    *,
    analysis: ReferenceAnalysis | None = None,
    output: ModelOutfits | None = None,
) -> None:
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        if datetime.fromisoformat(str(data["deadline"])) <= utcnow():
            raise AppError("BUDGET_EXCEEDED", "参考任务超过五分钟总期限")
        row = require(db, UUID(str(data["reference_id"])), True)
        if row.current_job_id != job.id:
            raise AppError("VERSION_CONFLICT", "参考任务已被替换")
        revisions: list[UUID] = []
        if analysis is not None:
            row.analysis = analysis.model_dump(mode="json")
            row.clues = [c.model_dump(mode="json") for c in analysis.clues]
            row.confirmed = False
        elif output is not None:
            ids = {gid for p in output.outfits for gid in p.garment_ids}
            garments = {
                g.id: g
                for g in db.scalars(
                    select(Garment)
                    .where(Garment.id.in_(ids))
                    .order_by(Garment.id)
                    .with_for_update()
                )
            }
            versions = cast(dict[str, JsonValue], data["candidate_versions"])
            if ids != garments.keys() or any(
                not eligible(g) or g.version != versions.get(str(g.id)) for g in garments.values()
            ):
                raise AppError("CONSTRAINT_CONFLICT", "生成期间单品已修改或不可用，请重新核对")
            clues = [ReferenceClue.model_validate(c) for c in cast(list[JsonValue], data["clues"])]
            tags = {str(t.id): t.name for t in db.scalars(select(Tag))}
            session = OutfitSession(
                owner_id=row.owner_id, requirements=Requirements().model_dump(mode="json")
            )
            db.add(session)
            db.flush()
            for position, proposal in enumerate(output.outfits):
                items = [snapshot(db, garments[gid], tags) for gid in proposal.garment_ids]
                close, missing = evidence(clues, [i.attributes for i in items])
                revision = OutfitRevision(
                    id=uuid4(),
                    session_id=session.id,
                    run_id=job.id,
                    position=position,
                    items=[i.model_dump(mode="json") for i in items],
                    reason="参考图近似方案，不保证同款。\n接近的部分：\n" + "\n".join(close),
                    unmet_requirements=missing,
                    weather_snapshot={"source": "unknown"},
                    request_snapshot={
                        "reference_id": str(row.id),
                        "reference_clues": data["clues"],
                        "prompt_version": data["prompt_version"],
                        "model": data["model"],
                        "reference_version": row.version - 1,
                    },
                    provider_mode=str(data["provider_mode"]),
                )
                db.add(revision)
                revisions.append(revision.id)
            session.latest_revision_ids = list(map(str, revisions))
            session.selected_revision_id = revisions[0] if revisions else None
            row.revision_ids = list(map(str, revisions))
        row.version += 1
        row.provider_mode = str(data["provider_mode"])
        result = ReferenceResult(
            reference_id=row.id,
            action="analyze" if analysis else "generate",
            revision_ids=revisions,
            no_match=output is not None and not revisions,
        ).model_dump(mode="json")
        job.status, job.result, job.lease_token = "succeeded", result, None
        append_event(db, job, "result", result)
        append_event(db, job, "status", {"status": "succeeded"})
