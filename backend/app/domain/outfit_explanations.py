"""Render recorded facts from final snapshots, never from provider prose."""

from collections.abc import Sequence

from app.domain.taxonomy import TAXONOMY
from app.schemas.outfits import ItemSnapshot

EXPLANATION_VERSION = "facts-v1"
FIELDS = {
    "color_codes": "颜色",
    "occasion_codes": "场合",
    "style_codes": "风格",
    "seasons": "季节",
    "material": "材质",
    "thickness": "厚薄",
    "warmth": "保暖",
}
AESTHETICS = {
    "color_echo": "可尝试让不同单品的颜色相互呼应。",
    "color_contrast": "可尝试用颜色对比作为搭配方向。",
    "simple_palette": "可尝试减少整体配色种类。",
}


def explain(items: list[ItemSnapshot], aesthetic_codes: Sequence[str]) -> str:
    lines = ["事实说明（按本次保存的属性）："]
    for index, item in enumerate(items, 1):
        if item.source != "wardrobe":
            continue
        category = TAXONOMY["category"].get(item.slot, "单品")
        facts, unknown = [], []
        for field, label in FIELDS.items():
            value = item.attributes.get(field)
            values = value if isinstance(value, list) else [value] if value else []
            labels = [TAXONOMY[field][str(v)] for v in values if str(v) in TAXONOMY[field]]
            if labels:
                facts.append(f"{label}：{'、'.join(labels)}")
            else:
                unknown.append(label)
        detail = "；".join(facts)
        if unknown:
            detail += ("；" if detail else "") + "未知：" + "、".join(unknown)
        lines.append(f"第{index}件（{category}）：{detail}。")
    lines.append("未采集版型、舒适性、精确适温和导入批次；不据此判断是否满足相关要求。")
    advice = [AESTHETICS[c] for c in dict.fromkeys(aesthetic_codes) if c in AESTHETICS]
    if advice:
        lines.append("审美建议（主观尝试，不是单品属性或匹配结论）：" + "".join(advice))
    return "\n".join(lines)


def summary(count: int, *, empty_wardrobe: bool, clarify: bool) -> str:
    if clarify:
        return "请明确要替换的单品，或说明是否重搭全部未锁定单品。"
    if count:
        return f"已生成{count}套不同组合。事实说明来自单品快照；审美建议单独标明。"
    if empty_wardrobe:
        return "衣橱没有真实可用单品，请先上传衣服；示例不参与搭配。"
    return "本次未生成通过校验的组合，请核对条件后再试；不能据此断定衣橱没有可行搭配。"
