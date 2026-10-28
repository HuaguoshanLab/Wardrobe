import pytest

from app.core.config import Settings
from app.observability.pricing import PROFILE, estimate


def settings(**kwargs):
    return Settings(
        langfuse_price_profile=PROFILE,
        qwen_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        **kwargs,
    )


@pytest.mark.parametrize("count,rate", [(32768, 1), (32769, 1.5), (131072, 1.5), (131073, 3)])
def test_beijing_tiers_use_total_prompt_including_cache(count, rate):
    fields, costs = estimate(
        {"input": count - 1000, "input_cached": 1000, "output": 50}, settings()
    )
    assert fields["estimated_cost_cny"] == pytest.approx(
        ((count - 1000) * rate + 200 * rate + 500 * rate) / 1e6
    )
    assert fields["cost_status"] == "estimated_list_price"
    assert costs == {}  # CNY is never mislabeled USD.


def test_missing_usage_or_unverified_region_is_unknown():
    config = settings()
    assert estimate({"input": 50}, config) == ({"cost_status": "unknown"}, {})
    config.qwen_base_url = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    assert estimate({"input": 50, "output": 20}, config) == ({"cost_status": "unknown"}, {})


def test_usd_conversion_requires_explicit_exchange_rate():
    fields, costs = estimate({"input": 100, "output": 20}, settings(langfuse_cny_per_usd=7))
    assert fields["cny_per_usd"] == 7
    assert sum(costs.values()) == pytest.approx(fields["estimated_cost_cny"] / 7)
