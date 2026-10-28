import json
from unittest.mock import patch

import httpx
import pytest
import respx
from test_observability import exported
from test_recognition_provider import SETTINGS, URL, picture

from app.core.errors import AppError
from app.providers.qwen import invoke
from app.providers.recognition import recognize


def generation(telemetry):
    spans = exported(telemetry)
    return next(s for s in spans if s.name.startswith("qwen."))


@respx.mock
@pytest.mark.parametrize("vision", [False, True])
@pytest.mark.parametrize("valid", [False, True])
def test_usage_survives_invalid_model_output(telemetry, vision, valid):
    value = {"attributes": {"category": "top"}} if vision else {"outfits": []}
    route = respx.post(URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps(value) if valid else "SECRET invalid json"}}
                ],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 20,
                    "prompt_tokens_details": {"cached_tokens": 30},
                },
            },
        )
    )
    with patch("app.providers.qwen.get_settings", return_value=SETTINGS):

        def call():
            return recognize(picture(), SETTINGS) if vision else invoke({}, "outfits", 10)

        if valid:
            call()
        else:
            with pytest.raises(AppError):
                call()
    attrs = dict(generation(telemetry).attributes)
    usage = json.loads(attrs["langfuse.observation.usage_details"])
    assert usage == {"input": 70, "input_cached": 30, "output": 20}
    assert "SECRET" not in json.dumps(attrs)
    assert "base64" not in json.dumps(attrs)
    assert route.call_count == 1
    if not valid:
        assert attrs["langfuse.observation.level"] == "ERROR"


@respx.mock
@pytest.mark.parametrize("failure", ["timeout", "unauthorized"])
def test_provider_failure_preserved_without_retry(telemetry, failure):
    route = respx.post(URL)
    if failure == "timeout":
        route.mock(side_effect=httpx.ReadTimeout("sk-private-token"))
    else:
        route.mock(return_value=httpx.Response(401))
    with patch("app.providers.qwen.get_settings", return_value=SETTINGS):
        with pytest.raises(AppError):
            invoke({}, "outfits", 10)
    attrs = dict(generation(telemetry).attributes)
    assert attrs["langfuse.observation.level"] == "ERROR"
    assert "sk-private-token" not in json.dumps(attrs)
    assert "langfuse.observation.usage_details" not in attrs
    assert route.call_count == 1


def test_fake_is_not_a_billable_generation(telemetry):
    settings = SETTINGS.model_copy(update={"recognition_mode": "fake"})
    recognize(picture(), settings)
    spans = exported(telemetry)
    assert spans[0].name == "recognition.fake"
    assert spans[0].attributes["langfuse.observation.type"] == "span"
