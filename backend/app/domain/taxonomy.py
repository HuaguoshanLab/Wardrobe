"""Versioned controlled vocabulary shared by API, validation and Excel."""

TAXONOMY: dict[str, dict[str, str]] = {
    "category": {
        "top": "上装",
        "bottom": "下装",
        "dress": "连衣裙",
        "outerwear": "外套",
        "shoes": "鞋",
        "bag": "包",
        "hat": "帽子",
        "scarf": "围巾",
        "belt": "腰带",
        "jewelry": "首饰",
        "other_accessory": "其他配饰",
    },
    "color_codes": {
        "black": "黑色",
        "white": "白色",
        "gray": "灰色",
        "beige": "米色",
        "brown": "棕色",
        "blue": "蓝色",
        "green": "绿色",
        "red": "红色",
        "pink": "粉色",
        "yellow": "黄色",
        "orange": "橙色",
        "purple": "紫色",
        "silver": "银色",
        "gold": "金色",
        "multicolor": "多色",
    },
    "seasons": {"spring": "春", "summer": "夏", "autumn": "秋", "winter": "冬"},
    "occasion_codes": {
        "daily": "日常",
        "work": "通勤",
        "formal": "正式",
        "sport": "运动",
        "travel": "旅行",
        "date": "约会",
        "party": "聚会",
        "home": "居家",
    },
    "style_codes": {
        "casual": "休闲",
        "minimal": "简约",
        "classic": "经典",
        "sporty": "运动",
        "street": "街头",
        "elegant": "优雅",
        "vintage": "复古",
        "outdoor": "户外",
    },
    "material": {
        "cotton": "棉",
        "linen": "麻",
        "wool": "羊毛",
        "silk": "丝",
        "denim": "牛仔",
        "leather": "皮革",
        "synthetic": "化纤",
        "blend": "混纺",
        "other": "其他",
    },
    "thickness": {"thin": "薄", "medium": "中等", "thick": "厚"},
    "warmth": {"light": "清凉", "moderate": "适中", "warm": "保暖"},
    "availability": {"available": "可穿", "unavailable": "暂不可用"},
}
MULTI = {"color_codes", "seasons", "occasion_codes", "style_codes"}


def attribute_errors(values: dict[str, object]) -> list[str]:
    errors = []
    if not values.get("category"):
        errors.append("品类必填")
    for field, choices in TAXONOMY.items():
        value = values.get(field)
        selected = value if isinstance(value, list) else [value] if value else []
        for item in selected:
            if item not in choices:
                errors.append(f"{field}: 无法识别的值 {item}")
    return errors
