"""Deterministic inventory rules. No ORM, network calls, or model inference."""

from dataclasses import dataclass
from typing import Literal

from pydantic import JsonValue

from app.core.errors import AppError
from app.domain.taxonomy import TAXONOMY
from app.schemas.inventory import DemandSpec, EstimateInput, EstimateView


@dataclass(frozen=True)
class Assessment:
    bucket: Literal["confirmed", "pending", "excluded"]
    reasons: list[str]
    matched: bool = False
    needs_attention: bool = False


def assess(
    row: DemandSpec,
    season: str,
    attributes: dict[str, JsonValue],
    profile: dict[str, JsonValue],
    subtype_id: str | None,
    *,
    owned: bool = True,
    demo: bool = False,
) -> Assessment:
    if not owned or demo:
        return Assessment("excluded", ["已退出衣橱" if not owned else "示例单品"])
    unknown, mismatched = [], []
    for title, actual, wanted in [
        (
            "品类",
            [attributes.get("category")] if attributes.get("category") else [],
            [row.category],
        ),
        ("季节", attributes.get("seasons", []), [season]),
        ("子类", [subtype_id] if subtype_id else [], [str(s) for s in row.subtype_ids]),
        ("场合", attributes.get("occasion_codes", []), row.occasion_codes),
        ("标签", attributes.get("custom_tag_ids", []), [str(t) for t in row.tag_ids]),
    ]:
        if not wanted:
            continue
        if not actual:
            unknown.append(f"{title}待补充")
        elif not isinstance(actual, list) or not any(value in wanted for value in actual):
            mismatched.append(f"{title}不符合此行规则")
    if mismatched:
        return Assessment("excluded", mismatched)
    condition, fit = profile.get("condition", "unknown"), profile.get("fit", "unknown")
    problems = []
    if condition in {"needs_repair", "damaged"}:
        problems.append("需要维修" if condition == "needs_repair" else "严重损坏")
    if fit == "unfit":
        problems.append("不合身，可先核对是否能改衣")
    if problems:
        return Assessment("excluded", problems + unknown, not unknown, True)
    matched = not unknown
    if condition not in {"good", "worn"}:
        unknown.append("衣物状况待确认")
    if fit not in {"fits", "not_applicable"}:
        unknown.append("合身情况待确认")
    return Assessment("pending" if unknown else "confirmed", unknown, matched)


def conclusion(
    lower: int | None, upper: int | None, confirmed: int, pending: int
) -> tuple[Literal["unset", "review", "shortage", "enough", "excess"], int | None]:
    if lower is None or upper is None:
        return "unset", None
    if confirmed > upper:
        return "excess", confirmed - upper
    if confirmed >= lower:
        return "enough", 0
    if confirmed + pending >= lower:
        return "review", None
    return "shortage", lower - confirmed - pending


def estimate(payload: EstimateInput) -> EstimateView:
    if (
        payload.category not in {"top", "bottom", "dress"}
        or "formal" in payload.occasion_codes
        or set(payload.occasion_codes) - TAXONOMY["occasion_codes"].keys()
    ):
        raise AppError("MANUAL_TARGET", "此用途请手动设定目标，不适用日常洗衣轮换估算", 422)
    numerator = payload.weekly_days * (payload.laundry_days + payload.drying_days)
    denominator = 7 * payload.repeat_wears
    lower = (numerator + denominator - 1) // denominator + payload.spare
    return EstimateView(
        lower=lower,
        explanation=(
            f"向上取整（{payload.weekly_days} ×（{payload.laundry_days} + {payload.drying_days}）"
            f"÷ 7 ÷ {payload.repeat_wears}）+ {payload.spare} = {lower} 件。"
            "仅为轮换容量草稿，不是卫生标准；尚未扣除跨用途共享，上限由你设置。"
        ),
    )
