"""Season configuration writes and validation; every write has a version and receipt."""

from typing import cast

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.inventory import InventoryDemand, InventoryPlan
from app.db.lifecycle import GarmentSubtype
from app.db.models import utcnow
from app.db.session import session_factory
from app.db.wardrobe import Tag
from app.domain.inventory import estimate
from app.domain.taxonomy import TAXONOMY
from app.schemas.inventory import DemandSpec, EstimateInput, PlanInput, PlanView, Season
from app.services.operations import receipt, save_receipt


def configurations(db: Session) -> dict[str, PlanView]:
    plans = {p.season: p for p in db.scalars(select(InventoryPlan))}
    rows = list(
        db.scalars(
            select(InventoryDemand)
            .where(InventoryDemand.deleted_at.is_(None))
            .order_by(InventoryDemand.position, InventoryDemand.id)
        )
    )
    return {
        season: PlanView(
            season=cast(Season, season),
            version=plans[season].version if season in plans else 0,
            city=plans[season].city if season in plans else "",
            period=plans[season].period if season in plans else "",
            notes=plans[season].notes if season in plans else "",
            rows=[DemandSpec.model_validate(r.spec) for r in rows if r.season == season],
        )
        for season in TAXONOMY["seasons"]
    }


def read_configs() -> list[PlanView]:
    with session_factory()() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        return list(configurations(db).values())


def validate_row(db: Session, row: DemandSpec, old: DemandSpec | None) -> None:
    if row.category not in TAXONOMY["category"]:
        raise AppError("INVALID_RULE", "请选择有效的大类", 422)
    if set(row.occasion_codes) - TAXONOMY["occasion_codes"].keys():
        raise AppError("INVALID_RULE", "部分场合不存在", 422)
    for subtype_id in sorted(set(row.subtype_ids)):
        subtype = db.scalar(
            select(GarmentSubtype).where(GarmentSubtype.id == subtype_id).with_for_update(read=True)
        )
        if not subtype or subtype.category != row.category:
            raise AppError("INVALID_SUBTYPE", "子类不属于需求行的大类", 422)
        if not subtype.active and (old is None or subtype_id not in old.subtype_ids):
            raise AppError("INACTIVE_SUBTYPE", "停用子类不能新增引用，请选其他子类", 422)
    actual_tags = set(
        db.scalars(select(Tag.id).where(Tag.id.in_(row.tag_ids)).with_for_update(read=True))
    )
    # Existing broken references can be retained while editing unrelated targets, but
    # statistics flag the row invalid until the user explicitly repairs its rule.
    old_tags = set(old.tag_ids) if old else set()
    if set(row.tag_ids) - actual_tags - old_tags:
        raise AppError("INVALID_TAG", "新增的标签不存在，请刷新选项", 422)
    if row.estimate:
        estimate(
            EstimateInput(
                **row.estimate.model_dump(),
                category=row.category,
                occasion_codes=row.occasion_codes,
            )
        )


def save(season: Season, payload: PlanInput, key: str) -> PlanView:
    with session_factory().begin() as db:
        operation = f"inventory:{season}"
        digest, old_receipt = receipt(db, operation, key, payload.model_dump(mode="json"))
        if old_receipt:
            return PlanView.model_validate(old_receipt.response)
        # Serializes first creation too; row locks cannot lock a missing plan.
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:name, 0))"), {"name": operation}
        )
        plan = db.get(InventoryPlan, season)
        if (plan.version if plan else 0) != payload.expected_version:
            raise AppError("VERSION_CONFLICT", "本季目标已更新，请保留草稿并读取最新版本")
        ids = [r.id for r in payload.rows]
        existing = {
            r.id: r
            for r in db.scalars(
                select(InventoryDemand).where(
                    (InventoryDemand.season == season) | InventoryDemand.id.in_(ids)
                )
            )
        }
        for row in payload.rows:
            old = existing.get(row.id)
            if old and (old.season != season or old.deleted_at):
                raise AppError("INVALID_ROW", "需求 ID 属于另一季节或已删除，请新增一行", 422)
            validate_row(db, row, DemandSpec.model_validate(old.spec) if old else None)
        if plan is None:
            plan = InventoryPlan(season=season, version=0)
            db.add(plan)
        plan.version += 1
        plan.city, plan.period, plan.notes = (
            payload.city.strip(),
            payload.period.strip(),
            payload.notes,
        )
        db.flush()
        for old in existing.values():
            if old.season == season and old.id not in ids and old.deleted_at is None:
                old.deleted_at = utcnow()
        for position, row in enumerate(payload.rows):
            target = existing.get(row.id)
            if target is None:
                target = InventoryDemand(id=row.id, season=season)
                db.add(target)
            target.position, target.spec = position, row.model_dump(mode="json")
        result = PlanView(
            season=season,
            version=plan.version,
            city=plan.city,
            period=plan.period,
            notes=plan.notes,
            rows=payload.rows,
        )
        try:
            db.flush()
        except IntegrityError as exc:
            raise AppError("ROW_CONFLICT", "需求行 ID 已被其他配置使用，请重新读取配置") from exc
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result
