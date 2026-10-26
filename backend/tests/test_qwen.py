from unittest.mock import patch

import httpx
import pytest
import respx

from app.core.config import Settings
from app.core.errors import AppError
from app.providers.qwen import invoke

SETTINGS = Settings(
    provider_mode="qwen",
    qwen_base_url="https://example.aliyuncs.com/compatible-mode/v1",
    qwen_api_key="test-secret",
)
URL = SETTINGS.qwen_base_url + "/chat/completions"


@respx.mock
def test_qwen_json_request_and_response():
    route = respx.post(URL).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": '{"outfits":[],"message":"没有匹配"}'}}]}
        )
    )
    with patch("app.providers.qwen.get_settings", return_value=SETTINGS):
        assert invoke({"test": "data"}, "outfits", 10)["message"] == "没有匹配"
    import json

    body = json.loads(route.calls.last.request.content)
    assert body["model"] == "qwen3-vl-plus"
    assert body["response_format"] == {"type": "json_object"}
    assert body["enable_thinking"] is False
    assert "test-secret" not in route.calls.last.request.url.path


@respx.mock
@pytest.mark.parametrize(
    "failure,code",
    [
        (401, "MODEL_UNAVAILABLE"),
        (429, "MODEL_UNAVAILABLE"),
        (503, "MODEL_UNAVAILABLE"),
        ("timeout", "CALL_RESULT_UNKNOWN"),
        ("invalid", "INVALID_MODEL_OUTPUT"),
    ],
)
def test_qwen_no_blind_http_retries(failure, code):
    route = respx.post(URL)
    if failure == "timeout":
        route.mock(side_effect=httpx.ReadTimeout("secret should not escape"))
    elif failure == "invalid":
        route.mock(return_value=httpx.Response(200, json={"choices": []}))
    else:
        route.mock(return_value=httpx.Response(failure))
    with patch("app.providers.qwen.get_settings", return_value=SETTINGS):
        with pytest.raises(AppError) as exc:
            invoke({}, "outfits", 10)
    assert exc.value.code == code
    assert route.call_count == 1
    assert "test-secret" not in exc.value.message
