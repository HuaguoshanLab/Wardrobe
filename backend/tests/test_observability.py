import json
import time
from unittest.mock import Mock
from uuid import uuid4

import pytest

from app.core.config import Settings
from app.core.errors import AppError
from app.observability import privacy, runtime


def exported(telemetry):
    sdk, exporter = telemetry
    sdk.flush()
    return exporter.get_finished_spans()


def test_tree_session_and_error_redaction(telemetry):
    job = str(uuid4())
    with runtime.session("session-test"), runtime.observation("job", job_id=job) as root:
        with pytest.raises(AppError):
            with runtime.observation("request", generation=True, model="qwen3-vl-plus"):
                raise AppError("INVALID_MODEL_OUTPUT", "secret-photo-and-prompt")
        root.update(fields={"status": "failed"}, level="ERROR", code="INVALID_MODEL_OUTPUT")
    spans = exported(telemetry)
    child, parent = spans
    assert child.parent.span_id == parent.context.span_id
    assert child.context.trace_id == parent.context.trace_id
    assert "session-test" in json.dumps(dict(child.attributes))
    serialized = json.dumps([dict(s.attributes) for s in spans])
    assert "INVALID_MODEL_OUTPUT" in serialized
    assert "secret-photo-and-prompt" not in serialized
    assert not child.events  # No automatic exception stack/arguments.
    with runtime.observation("replayed-job", job_id=job):
        pass
    assert exported(telemetry)[-1].context.trace_id == parent.context.trace_id


@pytest.mark.parametrize("phase", ["start", "update", "end"])
def test_telemetry_failure_never_repeats_or_swallows_business(monkeypatch, phase):
    sdk = Mock()
    sdk.start_observation.return_value.id = "a" * 16
    sdk.start_observation.return_value.trace_id = "b" * 32
    target = (
        sdk.start_observation
        if phase == "start"
        else getattr(sdk.start_observation.return_value, phase)
    )
    target.side_effect = RuntimeError("telemetry failed")
    monkeypatch.setattr(runtime, "client", lambda: sdk)
    calls = []
    original = AppError("BUSINESS_ERROR", "keep me")
    with pytest.raises(AppError) as caught:
        with runtime.observation("job") as handle:
            calls.append(1)
            handle.update(fields={"status": "running"})
            raise original
    assert caught.value is original and calls == [1]
    assert runtime._current.get() is None


def test_disabled_and_bad_configuration_do_not_create_sdk(monkeypatch):
    factory = Mock(side_effect=AssertionError("must not initialize"))
    monkeypatch.setattr(runtime, "Langfuse", factory)
    for settings in [Settings(), Settings(langfuse_enabled=True)]:
        runtime.client.cache_clear()
        monkeypatch.setattr(runtime, "get_settings", lambda settings=settings: settings)
        with runtime.observation("disabled"):
            pass
    assert not factory.called
    runtime.client.cache_clear()


def test_shutdown_has_deadline(monkeypatch):
    sdk = Mock()
    sdk.shutdown.side_effect = lambda: time.sleep(0.2)
    monkeypatch.setattr(runtime, "client", lambda: sdk)
    start = time.monotonic()
    runtime.shutdown(timeout=0.01)
    assert time.monotonic() - start < 0.15


def test_usage_unknown_zero_and_cache_partition():
    assert privacy.usage(None) == {}
    assert privacy.usage({"prompt_tokens": True, "completion_tokens": -1}) == {}
    assert privacy.usage({"prompt_tokens": 0, "completion_tokens": 0}) == {"input": 0, "output": 0}
    assert privacy.usage(
        {
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "prompt_tokens_details": {"cached_tokens": 40},
        }
    ) == {"input": 60, "input_cached": 40, "output": 20}


def test_allowlist_and_text_filter():
    safe = privacy.metadata(
        {
            "job_id": "id",
            "lease_token": "secret",
            "image": b"image",
            "api_key": "key",
            "latitude": 22.1,
            "message": "private",
        }
    )
    assert safe == {"job_id": "id"}
    assert privacy.text("data:image/jpeg;base64,SECRET https://secret.test/x sk-test-secret") == (
        "[media omitted] [url omitted] [credential omitted]"
    )
    assert len(privacy.text("a" * 10000)) == 8000
