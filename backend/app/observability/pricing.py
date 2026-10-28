"""Explicit dated list-price estimate; no FX lookup, free-credit or billing assumptions."""

from urllib.parse import urlsplit

from app.core.config import Settings

PROFILE = "bailian_beijing_20261028"


def estimate(
    usage: dict[str, int], settings: Settings
) -> tuple[dict[str, object], dict[str, float]]:
    host = urlsplit(settings.qwen_base_url).hostname or ""
    supported_host = host == "dashscope.aliyuncs.com" or host.endswith(
        ".cn-beijing.maas.aliyuncs.com"
    )
    if (
        settings.langfuse_price_profile != PROFILE
        or not supported_host
        or settings.qwen_model != "qwen3-vl-plus"
        or not {"input", "output"} <= usage.keys()
    ):
        return {"cost_status": "unknown"}, {}
    prompt = usage["input"] + usage.get("input_cached", 0)
    if prompt > 262144:
        return {"cost_status": "unknown"}, {}
    # Official Beijing synchronous inference list prices, CNY / million tokens.
    rate = 1.0 if prompt <= 32768 else 1.5 if prompt <= 131072 else 3.0
    costs = {
        "input": usage["input"] * rate / 1_000_000,
        "output": usage["output"] * rate * 10 / 1_000_000,
        "input_cached": usage.get("input_cached", 0) * rate * 0.2 / 1_000_000,
    }
    fields: dict[str, object] = {
        "cost_status": "estimated_list_price",
        "price_profile": PROFILE,
        "estimated_cost_cny": sum(costs.values()),
    }
    if settings.langfuse_cny_per_usd is None:
        return fields, {}
    fields["cny_per_usd"] = settings.langfuse_cny_per_usd
    return fields, {key: value / settings.langfuse_cny_per_usd for key, value in costs.items()}
