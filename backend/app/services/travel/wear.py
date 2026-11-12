"""Explicit confirmation copies a travel day into the existing actual-wear system."""

from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.core.errors import AppError
from app.db.collections import WearRecord
from app.db.models import utcnow
from app.db.outfits import OutfitRevision
from app.db.session import session_factory
from app.db.travel import TravelRevision
from app.schemas.travel import TravelWear, TravelWearResult
from app.services.operations import receipt, save_receipt
from app.services.travel.plans import require


def record(plan_id: UUID, payload: TravelWear, key: str) -> TravelWearResult:
    with session_factory().begin() as db:
        operation = f"travel-wear:{plan_id}"
        digest, old = receipt(db, operation, key, payload.model_dump(mode="json"))
        if old:
            return TravelWearResult.model_validate(old.response)
        require(db, plan_id, True)
        revision = db.get(TravelRevision, payload.revision_id)
        day = (
            next((d for d in revision.days if d["date"] == str(payload.day)), None)
            if revision and revision.plan_id == plan_id
            else None
        )
        if not day:
            raise AppError("INVALID_TARGET", "日期不属于此行程版本", 422)
        if payload.day > utcnow().astimezone(ZoneInfo("Asia/Shanghai")).date():
            raise AppError("FUTURE_WEAR", "只能确认今天或过去实际穿过的搭配", 422)
        source = f"{payload.revision_id}:{payload.day}"
        outfit = db.scalar(
            select(OutfitRevision).where(
                OutfitRevision.request_snapshot["travel_day"].astext == source
            )
        )
        if outfit is None:
            outfit = OutfitRevision(
                id=uuid4(),
                source="manual",
                position=0,
                items=day["items"],
                reason="手动确认旅行计划中的实际穿着",
                unmet_requirements=[],
                weather_snapshot=day["weather"],
                request_snapshot={"travel_day": source, "travel_plan_id": str(plan_id)},
            )
            db.add(outfit)
            db.flush()
        wear = db.scalar(
            select(WearRecord).where(
                WearRecord.revision_id == outfit.id, WearRecord.worn_on == payload.day
            )
        )
        if wear is None:
            wear = WearRecord(
                id=uuid4(), revision_id=outfit.id, worn_on=payload.day, notes=payload.notes
            )
            db.add(wear)
            db.flush()
        result = TravelWearResult(wear_record_id=wear.id, outfit_revision_id=outfit.id)
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result
