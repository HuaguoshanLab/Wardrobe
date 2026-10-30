"""Deterministic soft ranking over proposals that already passed hard validation."""

from fractions import Fraction
from uuid import UUID

from pydantic import JsonValue

from app.schemas.outfits import Intent, OutfitContext, Proposal

BODY_SLOTS = frozenset({"top", "bottom", "dress", "outerwear"})


def evaluated_ids(ids: list[UUID], context: OutfitContext, intent: Intent | None) -> set[str]:
    selected = set(map(str, ids))
    if intent and intent.scope == "replace_items":
        preserved = {
            str(i.garment_id) for i in context.base_items if i.item_id not in intent.target_item_ids
        }
        return selected - preserved
    # Shoes/bags do not dominate rotation of clothing. Shoe-only wardrobes still work.
    body = {
        str(c["id"])
        for c in context.candidates
        if c.get("category") in BODY_SLOTS and str(c["id"]) in selected
    }
    return body or selected


def repeats(ids: list[UUID], context: OutfitContext) -> tuple[bool, bool]:
    selected = set(map(str, ids))
    body = {
        str(c["id"])
        for c in context.candidates
        if str(c["id"]) in selected and c.get("category") in BODY_SLOTS
    }
    combinations = context.rotation.combinations if context.rotation else []
    return (
        any(selected == set(c.garment_ids) for c in combinations),
        bool(body) and any(body == set(c.body_ids) for c in combinations),
    )


def score(ids: list[UUID], context: OutfitContext, intent: Intent | None) -> tuple[int, Fraction]:
    stats = context.rotation
    mode = context.requirements.rotation_mode
    if not stats or mode == "normal":
        return (0, Fraction(0))
    measured = evaluated_ids(ids, context, intent)
    days = Fraction(sum(stats.garment_days.get(i, 0) for i in measured), max(len(measured), 1))
    if mode == "less_worn":
        return (0, days)
    full, body = repeats(ids, context)
    # With accessory-only replacement, the preserved body is not a movable target.
    if intent and intent.scope == "replace_items":
        target_slots = {i.slot for i in context.base_items if i.item_id in intent.target_item_ids}
        if not target_slots & BODY_SLOTS:
            body = False
    return (int(full or body), Fraction(0))


def rank(
    proposals: list[Proposal], context: OutfitContext, intent: Intent | None
) -> list[Proposal]:
    if context.requirements.rotation_mode == "normal" or not context.rotation:
        return proposals
    # Conditions/completeness precede rotation. Stable ties preserve provider order.
    return sorted(
        proposals, key=lambda p: (len(p.unmet_requirements), score(p.garment_ids, context, intent))
    )


def assessment(
    ids: list[UUID], context: OutfitContext, intent: Intent | None
) -> dict[str, JsonValue] | None:
    stats = context.rotation
    mode = context.requirements.rotation_mode
    if not stats or mode == "normal":
        return None
    avoid = mode == "avoid_recent"
    records, days = (stats.records_7, stats.days_7) if avoid else (stats.records_30, stats.days_30)
    full, body = repeats(ids, context)
    measured = evaluated_ids(ids, context, intent)
    candidates = {str(c["id"]): c for c in context.candidates}
    if not records:
        message = "这个时间段还没有实际穿着记录，轮换依据不足；无记录不代表从未穿过。"
    elif avoid:
        message = (
            "这套完整组合在近 7 天有穿着记录。"
            if full
            else "这套主体组合在近 7 天有穿着记录；只换鞋包不算主体轮换。"
            if body
            else "近 7 天的记录中未出现这套完整组合或相同主体组合。"
        )
    else:
        message = "按下列单品近 30 天的记录穿着天数比较，优先较少的方案；同一单品同一天只计一次。"
    if context.locked_garment_ids:
        message += " 锁定单品保持不变，轮换服从锁定条件。"
    if intent and intent.scope == "replace_items":
        message += " 本次只比较替换项，其余单品完整保留。"
    if avoid and (full or body) and records:
        message += " 保留当前可行方案；轮换是软目标，不保证每次都能避开重复。"
    items: list[JsonValue] = [
        {
            "garment_id": gid,
            "name": str(candidates[gid].get("name") or "未命名单品"),
            "wear_days": stats.garment_days.get(gid, 0),
        }
        for gid in sorted(measured)
    ]
    return {
        "mode": mode,
        "as_of": str(stats.as_of),
        "start": str(stats.start_7 if avoid else stats.start_30),
        "timezone": stats.timezone,
        "record_count": records,
        "record_days": days,
        "full_repeat": full,
        "body_repeat": body,
        "message": message,
        "items": items if not avoid else [],
    }
