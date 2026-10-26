from uuid import UUID

from app.core.errors import AppError
from app.domain.taxonomy import TAXONOMY
from app.schemas.outfits import Intent, ModelOutfits, OutfitContext, Proposal


def target_constraints(context: OutfitContext, intent: Intent) -> tuple[set[UUID], set[UUID]]:
    items = {i.item_id: i for i in context.base_items}
    targets = set(intent.target_item_ids)
    locks = set(context.locked_garment_ids)
    if intent.scope == "replace_items":
        if not targets or not targets <= items.keys():
            raise AppError("INVALID_MODEL_OUTPUT", "替换目标不明确或不属于原方案")
        if any(items[i].garment_id in locks for i in targets):
            raise AppError("CONSTRAINT_CONFLICT", "目标单品已锁定，请先解锁")
        required = {
            i.garment_id for i in context.base_items if i.item_id not in targets and i.garment_id
        }
        excluded = {
            item.garment_id
            for key, item in items.items()
            if key in targets and item.garment_id is not None
        }
        return required | locks, excluded
    return locks, set()


def validate_proposals(
    result: ModelOutfits, context: OutfitContext, intent: Intent | None
) -> ModelOutfits:
    texts = [result.message] + [
        text
        for p in result.outfits
        for text in [p.reason, *p.unmet_requirements, *(s.description for s in p.suggestions)]
    ]
    if any(
        "http://" in text.lower() or "https://" in text.lower() or "www." in text.lower()
        for text in texts
    ):
        raise AppError("INVALID_MODEL_OUTPUT", "搭配输出不能包含购物链接")
    candidates = {UUID(str(c["id"])): c for c in context.candidates}
    required, excluded = (
        target_constraints(context, intent) if intent else (set(context.locked_garment_ids), set())
    )
    if not required <= candidates.keys():
        raise AppError("CONSTRAINT_CONFLICT", "需保持的衣服已不可用，请处理锁定或替换范围")
    if intent and len(result.outfits) > 1:
        raise AppError("INVALID_MODEL_OUTPUT", "调整只能返回一套新方案")
    accepted: list[Proposal] = []
    seen: set[frozenset[UUID]] = set()
    for proposal in result.outfits:
        ids = set(proposal.garment_ids)
        if len(ids) != len(proposal.garment_ids) or not ids <= candidates.keys():
            raise AppError("INVALID_MODEL_OUTPUT", "模型返回了不存在、重复或不可用的单品")
        if not required <= ids or ids & excluded:
            raise AppError("INVALID_MODEL_OUTPUT", "模型改变了保持项或没有替换目标")
        if intent and intent.scope == "replace_items":
            base_categories = {
                i.slot for i in context.base_items if i.item_id in intent.target_item_ids
            }
            if any(candidates[g]["category"] not in base_categories for g in ids - required):
                raise AppError("INVALID_MODEL_OUTPUT", "局部替换扩大到了其他服装位置")
        if any(
            s.category not in TAXONOMY["category"]
            or "http" in s.description.lower()
            or "www." in s.description.lower()
            for s in proposal.suggestions
        ):
            raise AppError("INVALID_MODEL_OUTPUT", "未拥有建议含非法品类或购物链接")
        if frozenset(ids) in seen:
            continue
        seen.add(frozenset(ids))
        unmet = list(proposal.unmet_requirements)
        for field, wanted in [
            ("occasion_codes", context.requirements.occasion_codes),
            ("seasons", context.requirements.season_codes),
            ("style_codes", context.preferences.get("style_codes", [])),
            ("custom_tag_ids", list(map(str, context.requirements.custom_tag_ids))),
        ]:
            if wanted:
                for gid in ids:
                    actual = candidates[gid].get(field)
                    label = str(
                        candidates[gid].get("name")
                        or TAXONOMY["category"].get(str(candidates[gid]["category"]), "单品")
                    )
                    field_label = {
                        "occasion_codes": "场合",
                        "seasons": "季节",
                        "style_codes": "风格",
                        "custom_tag_ids": "标签",
                    }[field]
                    if not actual:
                        unmet.append(f"{label}的{field_label}未标注，匹配情况未知")
                    elif (
                        isinstance(actual, list)
                        and isinstance(wanted, list)
                        and not set(map(str, actual)) & set(map(str, wanted))
                    ):
                        unmet.append(f"{label}的{field_label}与本次条件不匹配；保持项不会擅自替换")
        categories = {str(candidates[g]["category"]) for g in ids}
        if "dress" not in categories and not {"top", "bottom"} <= categories:
            unmet.append("衣橱内衣服未组成完整上下装或连衣裙搭配")
        if "shoes" not in categories:
            unmet.append("本套缺少鞋履")
        if any(not candidates[g].get("warmth") for g in ids):
            unmet.append("部分单品保暖程度未知，无法保证适合当前温度")
        proposal.unmet_requirements = list(dict.fromkeys(unmet))
        accepted.append(proposal)
    return ModelOutfits(outfits=accepted, message=result.message)
