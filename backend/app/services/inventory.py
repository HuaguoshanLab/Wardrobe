"""One consistent database snapshot for counts, drilldown, and cross-season coverage."""

from collections import defaultdict
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.db.lifecycle import GarmentSubtype
from app.db.session import session_factory
from app.db.wardrobe import Garment, MediaAsset, Tag
from app.domain.inventory import Assessment, assess, conclusion
from app.schemas.inventory import (
    Coverage,
    DemandSpec,
    InventoryCount,
    InventoryGarment,
    InventoryMember,
    InventoryView,
    Season,
)
from app.services.inventory_config import configurations
from app.services.supply_counts import planned_counts
from app.services.wardrobe import image_url


def rule_errors(
    row: DemandSpec, subtypes: dict[UUID, GarmentSubtype], tags: set[UUID]
) -> list[str]:
    errors = []
    if set(row.tag_ids) - tags:
        errors.append("引用的标签已删除，请编辑需求移除或替换")
    if any(s not in subtypes or subtypes[s].category != row.category for s in row.subtype_ids):
        errors.append("引用的子类不存在或与大类不符")
    return errors


def snapshot(season: Season) -> InventoryView:
    with session_factory()() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        db.execute(text("SET TRANSACTION READ ONLY"))
        return snapshot_in(db, season)


def snapshot_in(db: Session, season: Season) -> InventoryView:
    at = db.scalar(select(func.transaction_timestamp()))
    assert at is not None
    plans = configurations(db)
    subtypes = {s.id: s for s in db.scalars(select(GarmentSubtype))}
    tags = set(db.scalars(select(Tag.id)))
    records = list(
        db.execute(
            select(Garment, MediaAsset)
            .join(MediaAsset, Garment.image_asset_id == MediaAsset.id)
            .where(Garment.deleted_at.is_(None))
            .order_by(Garment.created_at.desc(), Garment.id)
        )
    )
    coverage: dict[UUID, list[Coverage]] = defaultdict(list)
    assessments: dict[UUID, dict[UUID, Assessment]] = {}
    invalid: dict[UUID, list[str]] = {}
    for key, plan in plans.items():
        for row in plan.rows:
            invalid[row.id] = rule_errors(row, subtypes, tags)
            values = {}
            for garment, _ in records:
                if garment.attributes.get("category") not in {None, row.category}:
                    continue
                result = assess(
                    row,
                    key,
                    garment.attributes,
                    garment.lifecycle,
                    str(garment.subtype_id) if garment.subtype_id else None,
                    owned=garment.ownership == "owned",
                    demo=garment.is_demo,
                )
                values[garment.id] = result
                if row.enabled and not invalid[row.id] and result.matched:
                    coverage[garment.id].append(
                        Coverage(id=row.id, season=plan.season, name=row.name)
                    )
            assessments[row.id] = values
    garments = {g.id: g for g, _ in records}
    counts = []
    planned = planned_counts(db)
    for row in plans[season].rows:
        values = {} if invalid[row.id] else assessments[row.id]
        confirmed = sum(v.bucket == "confirmed" for v in values.values())
        pending = sum(v.bucket == "pending" for v in values.values())
        status, difference = conclusion(row.lower, row.upper, confirmed, pending)
        errors = invalid[row.id]
        counts.append(
            InventoryCount(
                row_id=row.id,
                planned=planned.get(row.id, 0),
                matched_owned=sum(v.matched for v in values.values()),
                confirmed=confirmed,
                pending=pending,
                unavailable=sum(
                    v.matched and garments[gid].attributes.get("availability") == "unavailable"
                    for gid, v in values.items()
                ),
                available=sum(
                    v.bucket == "confirmed"
                    and garments[gid].attributes.get("availability") == "available"
                    for gid, v in values.items()
                ),
                needs_attention=sum(v.needs_attention for v in values.values()),
                shared=sum(len(coverage[gid]) > 1 for gid in values if values[gid].matched),
                conclusion="invalid" if errors else status if row.enabled else "disabled",
                difference=None if errors or not row.enabled else difference,
                rule_errors=errors,
                members=[
                    InventoryMember(
                        garment_id=gid,
                        bucket=v.bucket,
                        reasons=v.reasons,
                        covered_by=coverage[gid],
                    )
                    for gid, v in values.items()
                ],
            )
        )
    return InventoryView(
        plan=plans[season],
        stats_at=at,
        config_versions={s: p.version for s, p in plans.items()},
        total_owned=sum(g.ownership == "owned" and not g.is_demo for g, _ in records),
        counts=counts,
        garments=[
            InventoryGarment(
                id=g.id,
                version=g.version,
                name=str(g.attributes.get("name") or "未命名单品"),
                image_url=image_url(m, str(g.attributes.get("display_variant", "original"))) or "",
            )
            for g, m in records
        ],
    )
