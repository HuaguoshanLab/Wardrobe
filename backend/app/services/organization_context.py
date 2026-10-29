"""Shared deterministic evidence for suggestions and exit impact, never model inference."""

from collections import defaultdict
from dataclasses import dataclass
from hashlib import sha256
from typing import cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.wardrobe import Garment
from app.schemas.inventory import InventoryView, Season
from app.services.inventory import snapshot_in


@dataclass
class Context:
    views: list[InventoryView]
    garments: dict[UUID, Garment]
    reasons: dict[tuple[UUID, str], str]


def context(db: Session) -> Context:
    views = [snapshot_in(db, cast(Season, s)) for s in ("spring", "summer", "autumn", "winter")]
    garments = {g.id: g for g in db.scalars(select(Garment))}
    reasons: dict[tuple[UUID, str], str] = {}
    coverage: dict[UUID, list[tuple[str, str]]] = defaultdict(list)
    for v in views:
        rows = {r.id: r for r in v.plan.rows}
        for c in v.counts:
            if c.conclusion in {"invalid", "disabled"}:
                continue
            for member in c.members:
                if member.bucket != "confirmed":
                    continue
                coverage[member.garment_id].append((str(c.row_id), rows[c.row_id].name))
                if c.conclusion == "excess":
                    reasons[member.garment_id, f"excess:{c.row_id}"] = (
                        f"「{rows[c.row_id].name}」超过自定目标 {c.difference} 件；"
                        "这件符合该需求，是否保留由你决定。"
                    )
    groups: dict[tuple[tuple[str, str], ...], list[UUID]] = defaultdict(list)
    for gid, covered in coverage.items():
        groups[tuple(sorted(covered))].append(gid)
    for covered_rows, ids in groups.items():
        if len(ids) < 2 or len(covered_rows) < 2:
            continue
        key = "overlap:" + sha256(",".join(r[0] for r in covered_rows).encode()).hexdigest()[:32]
        for gid in ids:
            reasons[gid, key] = (
                f"{len(ids)} 件都符合「{'、'.join(r[1] for r in covered_rows)}」；"
                "用途覆盖相同不等于多余，也可能用于轮换。"
            )
    for gid, g in garments.items():
        if g.is_demo or g.deleted_at or g.ownership != "owned":
            continue
        condition = g.lifecycle.get("condition")
        if condition in {"needs_repair", "damaged"}:
            reasons[gid, f"condition:{condition}"] = (
                "已确认需要维修，可先评估修复。"
                if condition == "needs_repair"
                else "已确认严重损坏，请自行决定修复、保留或退出。"
            )
        if g.lifecycle.get("fit") == "unfit":
            reasons[gid, "fit:unfit"] = "已确认不合身，可先评估改衣。"
    return Context(views, garments, reasons)
