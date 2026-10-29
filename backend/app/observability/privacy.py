"""Allowlisted metadata and bounded opt-in text; never serialize model request bodies."""

import json
import re
from collections.abc import Mapping

from pydantic import JsonValue

KEYS = {
    "job_id",
    "kind",
    "session_id",
    "batch_id",
    "row_id",
    "retry_of_job_id",
    "provider_mode",
    "prompt_version",
    "attempt",
    "step",
    "status",
    "error_code",
    "candidate_count",
    "outfit_count",
    "failed_steps",
    "interrupted_rows",
    "reused",
    "usage_available",
    "http_status",
    "input_chars",
    "output_chars",
    "image_count",
    "category",
    "applied_fields",
    "protected_fields",
    "cost_status",
    "price_profile",
    "estimated_cost_cny",
    "cny_per_usd",
}


def metadata(values: Mapping[str, object]) -> dict[str, JsonValue]:
    return {
        key: value[:200] if isinstance(value, str) else value
        for key, value in values.items()
        if key in KEYS and (value is None or isinstance(value, (str, int, float, bool)))
    }


def text(value: object) -> str:
    """Debug text is opt-in; strip common credentials and URLs, including image data."""
    if not isinstance(value, str):
        return "[non-text omitted]"
    value = re.sub(r"data:[^\s\"']+", "[media omitted]", value)
    value = re.sub(r"https?://[^\s\"']+", "[url omitted]", value)
    value = re.sub(r"(?i)bearer\s+\S+|\b(?:sk|pk)-[\w-]+", "[credential omitted]", value)
    return value[:8000]


def outfit_input(request: Mapping[str, JsonValue], step: str) -> str:
    """An explicit summary, not the model's complete prompt or wardrobe snapshot."""
    context = request.get("context")
    context = context if isinstance(context, dict) else {}

    def select_fields(value: JsonValue, keys: tuple[str, ...]) -> dict[str, JsonValue]:
        if not isinstance(value, dict):
            return {}
        result: dict[str, JsonValue] = {}
        for key in keys:
            item = value.get(key)
            if item is None or isinstance(item, (bool, int, float)):
                result[key] = item
            elif isinstance(item, str):
                result[key] = item[:1000]
            elif isinstance(item, list):
                result[key] = [v[:100] for v in item[:30] if isinstance(v, str)]
        return result

    def count(key: str) -> int:
        value = context.get(key)
        return len(value) if isinstance(value, list) else 0

    summary = {
        "capture_scope": "input_summary",
        "step": step,
        **select_fields(dict(request), ("message", "correction")),
        "requirements": select_fields(
            context.get("requirements"), ("occasion_codes", "style_codes", "season_codes", "notes")
        ),
        "weather": select_fields(
            context.get("weather"), ("source", "temperature_c", "feels_like_c", "condition")
        ),
        "candidate_count": count("candidates"),
        "locked_count": count("locked_garment_ids"),
        "base_item_count": count("base_items"),
        "intent": select_fields(request.get("intent"), ("scope", "target_item_ids", "question")),
    }
    return json.dumps(summary, ensure_ascii=False)


def usage(raw: object) -> dict[str, int]:
    if not isinstance(raw, dict):
        return {}
    result = {}
    for source, target in (("prompt_tokens", "input"), ("completion_tokens", "output")):
        value = raw.get(source)
        if type(value) is int and value >= 0:
            result[target] = value
    details = raw.get("prompt_tokens_details")
    cached = details.get("cached_tokens") if isinstance(details, dict) else None
    # Cache reads are a subset of prompt_tokens, not additional input tokens.
    if type(cached) is int and "input" in result and 0 <= cached <= result["input"]:
        result["input"] -= cached
        result["input_cached"] = cached
    return result
