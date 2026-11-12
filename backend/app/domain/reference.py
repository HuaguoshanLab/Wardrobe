"""Evidence uses stored attributes only; unknowns are never visual matches."""

from collections import Counter
from typing import cast

from pydantic import JsonValue

from app.core.errors import AppError
from app.domain.taxonomy import TAXONOMY
from app.schemas.outfits import ModelOutfits
from app.schemas.reference import ReferenceAnalysis, ReferenceClue


def reviewed_analysis(analysis: ReferenceAnalysis, mode: str) -> ReferenceAnalysis:
    """Only controlled visual fields leave the model boundary; prose is not evidence."""
    warnings = ["仅分析可见服饰。遮挡、未标注属性和实际叠穿效果需人工核对。"]
    clues = analysis.clues
    if analysis.subject != "single":
        clues = []
        warnings.insert(0, "主体不明确，未选取任何人的衣服。请裁剪图片或手工添加线索。")
    if mode == "fake":
        warnings.insert(0, "模拟分析，不代表图片真实内容。")
    return ReferenceAnalysis(subject=analysis.subject, clues=clues, warnings=warnings)


def validate(
    output: ModelOutfits, candidates: dict[str, dict[str, JsonValue]], clues: list[ReferenceClue]
) -> None:
    seen: set[frozenset[str]] = set()
    seen_core: set[frozenset[str]] = set()
    for proposal in output.outfits:
        ids = list(map(str, proposal.garment_ids))
        signature = frozenset(ids)
        if len(signature) != len(ids) or not signature <= candidates.keys() or signature in seen:
            raise AppError("INVALID_MODEL_OUTPUT", "单品ID无效、重复或方案没有实际差异")
        seen.add(signature)
        counts = Counter(str(candidates[i].get("category")) for i in ids)
        if not (counts["dress"] or (counts["top"] and counts["bottom"])):
            raise AppError(
                "INVALID_MODEL_OUTPUT",
                "缺少上装加下装或连衣裙，不能将上装当下装；无可行组合时返回空方案",
            )
        requested = Counter(c.category for c in clues)
        if any(count > max(1, requested[category]) for category, count in counts.items()):
            raise AppError(
                "INVALID_MODEL_OUTPUT", "同品类单品超过参考线索所需数量，不能用多件上装填补下装缺项"
            )
        core = frozenset(
            i
            for i in ids
            if candidates[i].get("category") in {"top", "bottom", "dress", "outerwear"}
        )
        if core in seen_core:
            raise AppError("INVALID_MODEL_OUTPUT", "主体组合重复，不要仅更换配饰凑足三套")
        seen_core.add(core)
        if proposal.suggestions:
            raise AppError("INVALID_MODEL_OUTPUT", "缺项由后端核对，不能伪造衣橱单品")
        if not any(candidates[i].get("category") == clue.category for i in ids for clue in clues):
            raise AppError("INVALID_MODEL_OUTPUT", "方案与参考品类没有交集，应返回空方案")


def evidence(
    clues: list[ReferenceClue], items: list[dict[str, JsonValue]]
) -> tuple[list[str], list[str]]:
    close, missing = [], []
    remaining = list(items)
    for index, clue in enumerate(clues, 1):
        label = f"{index}. {TAXONOMY['category'][clue.category]}"
        options = [a for a in remaining if a.get("category") == clue.category]
        if not options:
            missing.append(f"{label}：本方案缺少此品类；仅作补充方向，不代表衣橱没有。")
            continue
        options.sort(
            key=lambda a: sum(
                len(set(getattr(clue, field)) & set(cast(list[str], a.get(field) or [])))
                for field in ("color_codes", "style_codes")
            ),
            reverse=True,
        )
        chosen = options[0]
        remaining.remove(chosen)
        options = [chosen]
        close.append(f"{label}：品类相符。")
        for field in ("color_codes", "style_codes"):
            wanted = getattr(clue, field)
            if not wanted:
                continue
            matches = [
                a for a in options if set(wanted) <= set(cast(list[str], a.get(field) or []))
            ]
            names = "、".join(TAXONOMY[field][v] for v in wanted)
            if matches:
                close.append(f"{label}：已记录{names}。")
            else:
                missing.append(f"{label}：未找到完整记录为{names}的对应项，未知属性不能视为匹配。")
        if clue.layer != "unknown":
            missing.append(f"{label}：层次仅作造型参考，现有属性无法确认叠穿效果。")
    return close, missing
