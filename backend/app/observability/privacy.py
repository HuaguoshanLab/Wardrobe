"""Allowlisted metadata and bounded opt-in text; never serialize model request bodies."""

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
