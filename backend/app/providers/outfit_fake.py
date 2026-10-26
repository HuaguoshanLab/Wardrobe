from itertools import product
from uuid import UUID

from app.domain.outfits import target_constraints
from app.schemas.outfits import Intent, ModelOutfits, OutfitContext, Proposal, Suggestion


def fake_intent(context: OutfitContext, message: str) -> Intent:
    if any(word in message for word in ["重搭", "重新搭配", "全套"]):
        return Intent(scope="rebuild_unlocked")
    aliases = {
        "裤": "bottom",
        "上衣": "top",
        "外套": "outerwear",
        "鞋": "shoes",
        "裙": "dress",
        "包": "bag",
    }
    categories = {v for k, v in aliases.items() if k in message}
    targets = [i.item_id for i in context.base_items if i.slot in categories]
    if ("换" in message or "替换" in message) and len(categories) == 1 and len(targets) == 1:
        return Intent(scope="replace_items", target_item_ids=targets)
    return Intent(scope="clarify", question="请明确要替换哪件单品，或选择“重搭未锁定部分”。")


def fake_outfits(context: OutfitContext, intent: Intent | None) -> ModelOutfits:
    required, excluded = (
        target_constraints(context, intent) if intent else (set(context.locked_garment_ids), set())
    )
    groups: dict[str, list[UUID]] = {}
    candidates = {UUID(str(c["id"])): c for c in context.candidates}
    for gid, c in candidates.items():
        if gid not in excluded and gid not in required:
            groups.setdefault(str(c["category"]), []).append(gid)
    combinations: list[list[UUID]] = []
    if intent and intent.scope == "replace_items":
        targets = [i for i in context.base_items if i.item_id in intent.target_item_ids]
        choices = [groups.get(i.slot, []) for i in targets]
        combinations = (
            [list(required) + list(values) for values in product(*choices)] if all(choices) else []
        )
    else:
        occupied = {str(candidates[g]["category"]) for g in required if g in candidates}
        structures = (
            [["dress"], ["top", "bottom"]]
            if not occupied & {"top", "bottom", "dress"}
            else [([] if "dress" in occupied else ["top", "bottom"])]
        )
        for structure in structures:
            if structure == ["dress"] and not groups.get("dress"):
                continue
            slots = [
                s for s in structure + ["shoes", "outerwear"] if s not in occupied and groups.get(s)
            ]
            for values in product(*(groups[s][:3] for s in slots)):
                ids = list(required) + list(values)
                if ids:
                    combinations.append(ids)
                if len(combinations) >= 6:
                    break
        if not combinations and candidates:
            combinations = [list(required) or [next(iter(candidates))]]
    outfits = []
    for ids in combinations:
        if len(set(ids)) != len(ids):
            continue
        outfits.append(
            Proposal(
                garment_ids=ids,
                reason="Fake 模拟搭配：按真实可用单品组合，用于验证流程，不代表真实 AI 审美判断。",
                unmet_requirements=["Fake 模式未理解全部文字偏好，请人工核对。"],
                suggestions=[
                    Suggestion(
                        category="shoes",
                        description="未拥有建议：可考虑适合场合的鞋履，请自行确认。",
                    )
                ]
                if not any(candidates[i]["category"] == "shoes" for i in ids)
                else [],
            )
        )
        if len(outfits) == (1 if intent else 3):
            break
    return ModelOutfits(
        outfits=outfits,
        message="已完成模拟搭配，请核对未知属性。"
        if outfits
        else "没有满足保持条件的替换项，请补充衣橱或调整范围。",
    )
