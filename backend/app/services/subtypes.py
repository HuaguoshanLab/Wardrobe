"""Subtype edits preserve IDs and require a current reference-impact preview."""

import hashlib
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.inventory import InventoryDemand, InventoryPlan
from app.db.lifecycle import GarmentSubtype
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.schemas.lifecycle import SubtypeImpact, SubtypePatch, SubtypeReference, SubtypeView
from app.services.operations import receipt, save_receipt

SUGGESTIONS = {
    "top": ["T恤", "衬衫", "针织衫", "卫衣"],
    "bottom": ["长裤", "短裤", "半身裙"],
    "dress": ["日常连衣裙", "正式连衣裙"],
    "outerwear": ["薄外套", "大衣", "羽绒服"],
    "shoes": ["运动鞋", "休闲鞋", "靴子", "凉鞋"],
    "bag": ["双肩包", "手提包", "斜挎包"],
    "hat": ["棒球帽", "针织帽"],
    "scarf": ["围巾", "丝巾"],
    "belt": ["腰带"],
    "jewelry": ["项链", "耳饰", "手链"],
    "other_accessory": ["手套", "其他"],
}


def find(db: Session, subtype_id: UUID, lock: bool = False) -> GarmentSubtype:
    query = select(GarmentSubtype).where(GarmentSubtype.id == subtype_id)
    value = db.scalar(query.with_for_update() if lock else query)
    if not value:
        raise AppError("NOT_FOUND", "子类不存在", 404)
    return value


def impact(db: Session, row: GarmentSubtype) -> SubtypeImpact:
    garments = list(db.scalars(select(Garment).where(Garment.subtype_id == row.id)))
    references = list(
        db.execute(
            select(InventoryDemand, InventoryPlan.version)
            .join(InventoryPlan, InventoryDemand.season == InventoryPlan.season)
            .where(
                InventoryDemand.deleted_at.is_(None),
                InventoryDemand.spec["subtype_ids"].contains([str(row.id)]),
            )
            .order_by(InventoryDemand.id)
        )
    )
    evidence = {
        "version": row.version,
        "garments": sorted((str(g.id), g.version) for g in garments),
        "rows": [(str(r.id), v) for r, v in references],
    }
    token = hashlib.sha256(json.dumps(evidence, sort_keys=True).encode()).hexdigest()
    return SubtypeImpact(
        subtype=SubtypeView.model_validate(row),
        garment_count=len(garments),
        owned_count=sum(
            g.ownership == "owned" and not g.deleted_at and not g.is_demo for g in garments
        ),
        rows=[
            SubtypeReference(
                id=r.id, season=r.season, name=str(r.spec["name"]), enabled=bool(r.spec["enabled"])
            )
            for r, _ in references
        ],
        token=token,
    )


def read_impact(subtype_id: UUID) -> SubtypeImpact:
    with session_factory()() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        return impact(db, find(db, subtype_id))


def patch(subtype_id: UUID, payload: SubtypePatch, key: str) -> SubtypeView:
    with session_factory().begin() as db:
        operation = f"subtype:{subtype_id}"
        digest, old = receipt(db, operation, key, payload.model_dump(mode="json"))
        if old:
            return SubtypeView.model_validate(old.response)
        row = find(db, subtype_id, lock=True)
        if row.version != payload.expected_version:
            raise AppError("VERSION_CONFLICT", "子类已更新，请重新读取影响")
        if impact(db, row).token != payload.impact_token:
            raise AppError("IMPACT_CHANGED", "子类引用已变化，请重新读取影响后确认")
        name = payload.name.strip()
        if not name:
            raise AppError("INVALID_SUBTYPE", "子类名称不能为空", 422)
        row.name, row.active, row.version = name, payload.active, row.version + 1
        try:
            db.flush()
        except IntegrityError as exc:
            raise AppError("SUBTYPE_EXISTS", "此品类下已有同名子类") from exc
        result = SubtypeView.model_validate(row)
        save_receipt(db, operation, key, digest, result.model_dump(mode="json"))
        return result
