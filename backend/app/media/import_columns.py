"""Versioned Excel columns and human vocabulary for initial wardrobe facts."""

from datetime import date, datetime

BASE_COLUMNS = [
    "图片",
    "品类",
    "名称",
    "颜色",
    "季节",
    "场合",
    "风格",
    "材质",
    "厚度",
    "保暖程度",
    "自定义标签",
    "状态",
]
BASE_FIELDS = [
    "image",
    "category",
    "name",
    "color_codes",
    "seasons",
    "occasion_codes",
    "style_codes",
    "material",
    "thickness",
    "warmth",
    "tags",
    "availability",
]
DETAIL_COLUMNS = [
    "子类",
    "衣物状况",
    "合身情况",
    "获得来源",
    "获得日期",
    "购入金额（元）",
    "收纳状态",
    "收纳位置",
    "档案备注",
]
DETAIL_FIELDS = [
    "subtype_name",
    "condition",
    "fit",
    "source",
    "acquired_on",
    "price",
    "storage",
    "location",
    "notes",
]
COLUMNS = BASE_COLUMNS + DETAIL_COLUMNS
FIELDS = BASE_FIELDS + DETAIL_FIELDS
LABELS = dict(zip(FIELDS, COLUMNS, strict=True))
CHOICES = {
    "condition": {
        "未知": "unknown",
        "完好": "good",
        "轻微磨损": "worn",
        "需要维修": "needs_repair",
        "严重损坏": "damaged",
    },
    "fit": {"未知": "unknown", "合身": "fits", "不合身": "unfit", "不适用": "not_applicable"},
    "source": {"购买": "purchased", "获赠": "gift", "其他": "other"},
    "storage": {"日常使用": "daily", "已收纳": "stored"},
}


def detail_value(name: str, value: object) -> object:
    if name == "acquired_on" and isinstance(value, (date, datetime)):
        return (value.date() if isinstance(value, datetime) else value).isoformat()
    text = str(value).strip()
    if name in CHOICES:
        return CHOICES[name].get(text, text)
    return text
