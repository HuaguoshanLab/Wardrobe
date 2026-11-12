from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Job, utcnow
from app.db.profile import CityRecord
from app.db.session import session_factory
from app.db.travel import TravelPlan, TravelRevision
from app.schemas.jobs import TERMINAL
from app.schemas.travel import (
    PackingItem,
    TravelInput,
    TravelPack,
    TravelRevisionView,
    TravelUpdate,
    TravelVersion,
    TravelView,
)
from app.services.operations import owner_id, receipt, save_receipt


def require(db: Session, plan_id: UUID, lock: bool = False) -> TravelPlan:
    query = select(TravelPlan).where(
        TravelPlan.id == plan_id,
        TravelPlan.owner_id == owner_id(db),
        TravelPlan.deleted_at.is_(None),
    )
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise AppError("TRAVEL_NOT_FOUND", "旅行计划不存在或已删除", 404)
    return row


def check(row: TravelPlan, version: int, db: Session, *, idle: bool = True) -> None:
    if row.version != version:
        raise AppError("VERSION_CONFLICT", "计划已变化，请保留输入并读取最新版本")
    job = db.get(Job, row.current_job_id) if row.current_job_id else None
    if idle and job and job.status not in TERMINAL:
        raise AppError("TRAVEL_BUSY", "计划正在生成，请等待完成或取消任务")


def view(db: Session, row: TravelPlan) -> TravelView:
    saved = db.get(TravelRevision, row.current_revision_id) if row.current_revision_id else None
    revision = TravelRevisionView.model_validate(saved) if saved else None
    packing: dict[UUID, PackingItem] = {}
    if revision:
        for day in revision.days:
            for item in day.items:
                assert item.garment_id is not None
                gid = item.garment_id
                if gid not in packing:
                    packing[gid] = PackingItem(
                        garment_id=gid,
                        item=item,
                        dates=[],
                        packed=str(gid) in row.packed_ids,
                        added=str(gid) in row.added_ids,
                    )
                packing[gid].dates.append(day.date)
    return TravelView(
        id=row.id,
        version=row.version,
        draft=TravelInput.model_validate(row.draft),
        current_job_id=row.current_job_id,
        revision=revision,
        packing=list(packing.values()),
        created_at=row.created_at,
    )


def listing(offset: int = 0) -> list[TravelView]:
    with session_factory()() as db:
        rows = db.scalars(
            select(TravelPlan)
            .where(TravelPlan.owner_id == owner_id(db), TravelPlan.deleted_at.is_(None))
            .order_by(TravelPlan.created_at.desc(), TravelPlan.id)
            .offset(offset)
            .limit(20)
        )
        return [view(db, row) for row in rows]


def get(plan_id: UUID) -> TravelView:
    with session_factory()() as db:
        return view(db, require(db, plan_id))


def check_city(db: Session, payload: TravelInput) -> None:
    if payload.city.source == "qweather":
        city = db.get(CityRecord, payload.city.id)
        if city is None or city.data != payload.city.model_dump(mode="json"):
            raise AppError("CITY_NOT_FOUND", "请重新搜索并选择有效大陆城市，或改为手填", 422)


def create(payload: TravelInput, key: str) -> TravelView:
    with session_factory().begin() as db:
        digest, old = receipt(db, "travel-create", key, payload.model_dump(mode="json"))
        if old:
            return TravelView.model_validate(old.response)
        check_city(db, payload)
        row = TravelPlan(owner_id=owner_id(db), draft=payload.model_dump(mode="json"))
        db.add(row)
        db.flush()
        result = view(db, row)
        save_receipt(db, "travel-create", key, digest, result.model_dump(mode="json"))
        return result


def mutate(
    plan_id: UUID, payload: TravelUpdate | TravelPack | TravelVersion, key: str, action: str
) -> TravelView:
    with session_factory().begin() as db:
        op = f"travel-{action}:{plan_id}"
        digest, old = receipt(db, op, key, payload.model_dump(mode="json"))
        if old:
            return TravelView.model_validate(old.response)
        row = require(db, plan_id, True)
        check(row, payload.expected_version, db, idle=action != "pack")
        if isinstance(payload, TravelUpdate):
            check_city(db, payload)
            row.draft = payload.model_dump(mode="json", exclude={"expected_version"})
        elif isinstance(payload, TravelPack):
            ids = {str(i.garment_id) for i in view(db, row).packing}
            gid = str(payload.garment_id)
            if gid not in ids:
                raise AppError("INVALID_TARGET", "单品已不在当前行李清单中", 422)
            packed = set(row.packed_ids)
            packed.add(gid) if payload.packed else packed.discard(gid)
            row.packed_ids = sorted(packed)
            row.added_ids = [i for i in row.added_ids if i != gid]
        else:
            row.deleted_at = utcnow()
        row.version += 1
        result = view(db, row)
        save_receipt(db, op, key, digest, result.model_dump(mode="json"))
        return result


def revisions(plan_id: UUID, offset: int = 0) -> list[TravelRevisionView]:
    with session_factory()() as db:
        require(db, plan_id)
        return [
            TravelRevisionView.model_validate(r)
            for r in db.scalars(
                select(TravelRevision)
                .where(TravelRevision.plan_id == plan_id)
                .order_by(TravelRevision.number.desc())
                .offset(offset)
                .limit(20)
            )
        ]
