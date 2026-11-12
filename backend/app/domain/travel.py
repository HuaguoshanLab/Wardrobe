"""Hard travel constraints and factual packing assessment, independent of model prose."""

from collections import Counter

from pydantic import JsonValue

from app.core.errors import AppError
from app.schemas.travel import ModelTravel, TravelInput

# Shoes, bags, outerwear and accessories may be reused even when base clothing may not.
BASE_CATEGORIES = {"top", "bottom", "dress"}


def validate_plan(
    payload: TravelInput,
    proposal: ModelTravel,
    candidates: dict[str, dict[str, JsonValue]],
    preserved: dict[str, list[str]],
) -> list[str]:
    if [d.date for d in proposal.days] != [d.date for d in payload.days]:
        raise AppError("INVALID_MODEL_OUTPUT", "每日方案日期必须完整、有序且不重复")
    used: Counter[str] = Counter()
    for day in proposal.days:
        ids = list(map(str, day.garment_ids))
        if len(ids) != len(set(ids)) or not set(ids) <= candidates.keys():
            raise AppError("INVALID_MODEL_OUTPUT", "方案包含重复或无效单品")
        if str(day.date) in preserved and ids != preserved[str(day.date)]:
            raise AppError("INVALID_MODEL_OUTPUT", "调整不能改变其他日期的单品")
        categories = {candidates[gid]["category"] for gid in ids}
        if (
            not ("dress" in categories or {"top", "bottom"} <= categories)
            or "shoes" not in categories
        ):
            raise AppError(
                "INVALID_MODEL_OUTPUT", "每天需要上装加下装或裙装，以及鞋；衣橱不足时无法完成行程"
            )
        used.update(ids)
    if not set(map(str, payload.required_garment_ids)) <= used.keys():
        raise AppError("INVALID_MODEL_OUTPUT", "方案遗漏必带单品")
    if not payload.allow_repeat and any(
        count > 1 and candidates[gid]["category"] in BASE_CATEGORIES for gid, count in used.items()
    ):
        raise AppError("INVALID_MODEL_OUTPUT", "关闭重复穿后，上装、下装和裙装不得跨日重复")
    warnings = []
    if len(used) > payload.target_count:
        warnings.append(
            f"实际需要 {len(used)} 件，超过期望 {payload.target_count} 件；未为凑数量删减每日搭配。"
        )
    if any(
        count > 1 and candidates[gid]["category"] in BASE_CATEGORIES for gid, count in used.items()
    ):
        warnings.append("含重复穿着的上装、下装或裙装，请按逐日安排自行确认清洁条件。")
    return warnings
