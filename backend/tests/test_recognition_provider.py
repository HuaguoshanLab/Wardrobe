import base64
import io
import json

import httpx
import pytest
import respx
from PIL import Image

from app.core.config import Settings
from app.core.errors import AppError
from app.providers.recognition import recognize

SETTINGS = Settings(
    recognition_mode="qwen",
    qwen_base_url="https://example.aliyuncs.com/compatible-mode/v1",
    qwen_api_key="test-secret",
)
URL = SETTINGS.qwen_base_url + "/chat/completions"


def picture():
    output = io.BytesIO()
    Image.new("RGB", (1600, 800), "blue").save(output, "PNG")
    return output.getvalue()


def response(value):
    return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(value)}}]})


@respx.mock
def test_vision_request_bounded_image_and_unknowns():
    route = respx.post(URL).mock(
        return_value=response(
            {
                "attributes": {"category": "shoes", "color_codes": ["blue"]},
                "uncertainties": ["材质不可确定"],
            }
        )
    )
    result = recognize(picture(), SETTINGS)
    assert result.attributes.category == "shoes"
    assert result.attributes.seasons == []
    assert result.uncertainties == ["材质不可确定"]
    body = json.loads(route.calls.last.request.content)
    assert body["enable_thinking"] is False
    assert body["response_format"] == {"type": "json_object"}
    assert body["model"] == "qwen3-vl-plus"
    url = body["messages"][1]["content"][0]["image_url"]["url"]
    assert url.startswith("data:image/jpeg;base64,")
    image = Image.open(io.BytesIO(base64.b64decode(url.split(",")[1])))
    assert image.size == (1280, 640) and not image.getexif()
    assert "test-secret" not in json.dumps(body)
    assert route.call_count == 1


@respx.mock
@pytest.mark.parametrize(
    "attributes",
    [
        {"category": "made-up"},
        {"color_codes": ["unknown-color"]},
        {"availability": "unavailable"},
        {"custom_tag_ids": ["fake-id"]},
        {"material": "wool"},
        {"category": 42},
    ],
)
def test_invalid_output_cannot_become_draft(attributes):
    route = respx.post(URL).mock(return_value=response({"attributes": attributes}))
    with pytest.raises(AppError, match="识别结果") as exc:
        recognize(picture(), SETTINGS)
    assert exc.value.code == "INVALID_MODEL_OUTPUT" and route.call_count == 1


@respx.mock
@pytest.mark.parametrize(
    "failure,code",
    [
        (401, "MODEL_UNAVAILABLE"),
        (429, "MODEL_UNAVAILABLE"),
        (503, "MODEL_UNAVAILABLE"),
        ("timeout", "CALL_RESULT_UNKNOWN"),
        ("malformed", "INVALID_MODEL_OUTPUT"),
    ],
)
def test_no_transport_retries_or_secret_leak(failure, code):
    route = respx.post(URL)
    if failure == "timeout":
        route.mock(side_effect=httpx.ReadTimeout("test-secret"))
    elif failure == "malformed":
        route.mock(return_value=httpx.Response(200, content=b"bad json"))
    else:
        route.mock(return_value=httpx.Response(failure))
    with pytest.raises(AppError) as exc:
        recognize(picture(), SETTINGS)
    assert exc.value.code == code and route.call_count == 1
    assert "test-secret" not in exc.value.message


def test_recognition_independent_from_outfit_mode():
    settings = SETTINGS.model_copy(update={"provider_mode": "qwen", "recognition_mode": "disabled"})
    with pytest.raises(AppError) as exc:
        recognize(picture(), settings)
    assert exc.value.code == "PROVIDER_NOT_CONFIGURED"
    settings.recognition_mode = "fake"
    assert recognize(picture(), settings).attributes.category == "top"
