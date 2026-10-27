from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.outfits import OutfitImage, OutfitMessage, OutfitRevision
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.domain.outfit_explanations import EXPLANATION_VERSION, explain, summary
from app.domain.outfits import validate_proposals
from app.domain.taxonomy import TAXONOMY
from app.jobs.queue import check_lease
from app.schemas.outfits import Intent, ItemSnapshot, ModelOutfits, OutfitContext, OutfitResult
from app.schemas.wardrobe import Attributes
from app.services.jobs import append_event, get_job
from app.services.outfits.sessions import get_session
from app.services.wardrobe import asset


def commit_result(job_id: UUID, token: UUID) -> None:
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        if job.status == "succeeded":
            return
        check_lease(job, token)
        context = OutfitContext.model_validate(job.input_snapshot["context"])
        if utcnow() > context.deadline:
            raise AppError("BUDGET_EXCEEDED", "搭配任务超过总时限")
        saved = job.provider_response
        assert saved is not None
        intent = Intent.model_validate(saved["intent"]) if saved.get("intent") else None
        output = ModelOutfits.model_validate(saved["output"])
        output = (
            validate_proposals(output, context, intent)
            if not (intent and intent.scope == "clarify")
            else output
        )
        wanted = {gid for p in output.outfits for gid in p.garment_ids}
        rows = list(
            db.scalars(
                select(Garment).where(Garment.id.in_(wanted)).order_by(Garment.id).with_for_update()
            )
        )
        original = {UUID(str(c["id"])): c for c in context.candidates}
        if len(rows) != len(wanted) or any(
            g.deleted_at
            or g.attributes.get("availability") != "available"
            or g.version != original[g.id]["version"]
            for g in rows
        ):
            raise AppError("CONSTRAINT_CONFLICT", "生成期间衣服已修改或不可用，请重新核对条件")
        if output.outfits:
            today = str(utcnow().astimezone(ZoneInfo("Asia/Shanghai")).date())
            if context.weather.get("valid_for") != today:
                raise AppError("WEATHER_REQUIRED", "天气已跨日，请重新填写或获取")
            from datetime import datetime

            expiry = context.weather.get("expires_at")
            if expiry and datetime.fromisoformat(str(expiry)) <= utcnow():
                raise AppError("WEATHER_REQUIRED", "生成期间天气已过期，请重试获取最新实况")
        row = get_session(db, UUID(str(job.input_snapshot["session_id"])), lock=True)
        if row.current_job_id != job.id:
            raise AppError("CONSTRAINT_CONFLICT", "会话任务已改变")
        garments = {g.id: g for g in rows}
        revisions: list[UUID] = []
        for position, proposal in enumerate(output.outfits):
            items: list[ItemSnapshot] = []
            preserved = {
                i.garment_id: i
                for i in context.base_items
                if i.garment_id
                and (
                    (
                        intent
                        and intent.scope == "replace_items"
                        and i.item_id not in intent.target_item_ids
                    )
                    or i.garment_id in context.locked_garment_ids
                )
            }
            for gid in proposal.garment_ids:
                if gid in preserved:
                    items.append(preserved[gid])
                    continue
                garment = garments[gid]
                media = asset(db, garment.image_asset_id)
                key = (
                    media.cutout_key
                    if garment.attributes.get("display_variant") == "cutout"
                    else media.display_key
                )
                if not key:
                    raise AppError("CONSTRAINT_CONFLICT", "展示图片不可用")
                image = OutfitImage(id=uuid4(), media_asset_id=media.id, storage_key=key)
                db.add(image)
                attrs = Attributes.model_validate(garment.attributes).model_dump(mode="json")
                attrs["tag_names"] = [
                    context.tags.get(str(t), "")
                    for t in Attributes.model_validate(garment.attributes).custom_tag_ids
                ]
                items.append(
                    ItemSnapshot(
                        item_id=uuid4(),
                        slot=str(garment.attributes["category"]),
                        source="wardrobe",
                        garment_id=gid,
                        display_asset_id=image.id,
                        image_url=f"/api/v1/outfit-images/{image.id}",
                        attributes=attrs,
                    )
                )
            if intent and intent.scope == "replace_items":
                items.extend(
                    i
                    for i in context.base_items
                    if i.source == "suggestion" and i.item_id not in intent.target_item_ids
                )
            for suggestion in proposal.suggestions:
                if (
                    intent
                    and intent.scope == "replace_items"
                    and suggestion.category
                    not in {
                        i.slot for i in context.base_items if i.item_id in intent.target_item_ids
                    }
                ):
                    continue
                items.append(
                    ItemSnapshot(
                        item_id=uuid4(),
                        slot=suggestion.category,
                        source="suggestion",
                        description=f"未拥有建议：可考虑补充{TAXONOMY['category'][suggestion.category]}，具体属性待确认。",
                    )
                )
            revision = OutfitRevision(
                id=uuid4(),
                session_id=row.id,
                run_id=job.id,
                position=position,
                parent_revision_id=UUID(str(job.input_snapshot["base_revision_id"]))
                if job.kind == "outfit_adjust"
                else None,
                items=[i.model_dump(mode="json") for i in items],
                reason=explain(items, proposal.aesthetic_codes),
                unmet_requirements=proposal.unmet_requirements,
                weather_snapshot=context.weather,
                request_snapshot={
                    "requirements": context.requirements.model_dump(mode="json"),
                    "preferences": context.preferences,
                    "preference_version": context.preference_version,
                    "message": job.input_snapshot.get("message"),
                    "locked_garment_ids": list(map(str, context.locked_garment_ids)),
                    "intent": intent.model_dump(mode="json") if intent else None,
                    "prompt_version": job.input_snapshot["prompt_version"],
                    "model": job.input_snapshot["model"],
                    "explanation_version": EXPLANATION_VERSION,
                },
                provider_mode=str(job.input_snapshot["provider_mode"]),
            )
            db.add(revision)
            revisions.append(revision.id)
        if revisions:
            if job.kind == "outfit_adjust":
                row.latest_revision_ids = [
                    str(revisions[0]) if i == str(row.selected_revision_id) else i
                    for i in row.latest_revision_ids
                ]
            else:
                row.latest_revision_ids = list(map(str, revisions))
            row.selected_revision_id = revisions[0]
        unmet = list(dict.fromkeys(m for p in output.outfits for m in p.unmet_requirements))
        message = summary(
            len(revisions),
            empty_wardrobe=not context.candidates,
            clarify=bool(intent and intent.scope == "clarify"),
        )
        result = OutfitResult(
            session_id=row.id,
            revision_ids=revisions,
            outcome="needs_clarification"
            if intent and intent.scope == "clarify"
            else ("no_match" if not revisions else "partial" if unmet else "complete"),
            unmet_requirements=unmet or ([message] if not revisions else []),
            question=message if intent and intent.scope == "clarify" else None,
        )
        row.version += 1
        db.add(
            OutfitMessage(
                session_id=row.id,
                job_id=job.id,
                role="assistant",
                content=message,
                revision_ids=list(map(str, revisions)),
            )
        )
        job.result, job.status, job.lease_token = result.model_dump(mode="json"), "succeeded", None
        append_event(db, job, "result", job.result)
        append_event(db, job, "status", {"status": "succeeded"})
