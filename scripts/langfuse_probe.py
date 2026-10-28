"""Real local Langfuse transport + simulated model HTTP. No business DB or paid model calls."""

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
for line in (ROOT / ".env.langfuse-worker").read_text().splitlines():
    if line and not line.startswith("#"):
        key, value = line.split("=", 1)
        os.environ[key] = value
os.environ["WARDROBE_LANGFUSE_BASE_URL"] = "http://localhost:3006"
os.environ["WARDROBE_LANGFUSE_ENVIRONMENT"] = "acceptance"

import httpx
import respx
from app.core.config import Settings
from app.core.errors import AppError
from app.media.images import demo_image
from app.observability import runtime
from app.providers import qwen, recognition


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expect-unavailable", action="store_true")
    parser.add_argument("--bad-auth", action="store_true")
    args = parser.parse_args()
    if args.bad_auth:
        os.environ["WARDROBE_LANGFUSE_SECRET_KEY"] = "invalid-acceptance-key"
    settings = Settings(
        provider_mode="qwen",
        recognition_mode="qwen",
        qwen_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        qwen_api_key="mock-only-not-a-key",
    )
    job = str(uuid4())
    trace_id = hashlib.sha256(f"wardrobe:{job}".encode()).hexdigest()[:32]
    url = settings.qwen_base_url + "/chat/completions"
    sdk = runtime.client()
    if sdk is None:
        raise RuntimeError("Tracing not configured")
    with respx.mock(assert_all_called=True, assert_all_mocked=False) as router:
        route = router.post(url)

        def response(content):
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": content}}],
                    "usage": {
                        "prompt_tokens": 100,
                        "completion_tokens": 20,
                        "prompt_tokens_details": {"cached_tokens": 30},
                    },
                },
            )

        with (
            runtime.session("langfuse-acceptance"),
            runtime.observation(
                "acceptance.pipeline",
                job_id=job,
                fields={"job_id": job, "provider_mode": "mock"},
            ) as task,
            patch("app.providers.qwen.get_settings", return_value=settings),
        ):
            route.mock(return_value=response("not-json PRIVATE-SENTINEL"))
            try:
                qwen.invoke({}, "outfits", 5)
            except AppError as exc:
                if exc.code != "INVALID_MODEL_OUTPUT":
                    raise
            route.mock(return_value=response('{"outfits":[]}'))
            qwen.invoke({}, "outfits", 5)
            route.mock(return_value=response('{"attributes":{"category":"top"}}'))
            recognition.recognize(demo_image(), settings)
            with runtime.observation("model.response_reused", fields={"reused": True}):
                pass
            task.update(fields={"status": "succeeded"})
        if route.call_count != 3:
            raise RuntimeError("Unexpected simulated provider call count")
    sdk.flush()
    if args.expect_unavailable or args.bad_auth:
        print(
            json.dumps(
                {
                    "provider_calls": route.call_count,
                    "business_results": "preserved",
                    "mode": "bad-auth" if args.bad_auth else "outage",
                }
            )
        )
        runtime.shutdown()
        return
    auth = httpx.BasicAuth(
        settings.langfuse_public_key, settings.langfuse_secret_key.get_secret_value()
    )
    deadline = time.monotonic() + 45
    with httpx.Client(
        base_url="http://localhost:3006", auth=auth, trust_env=False, timeout=5
    ) as client:
        while True:
            response = client.get(
                "/api/public/v2/observations",
                params={
                    "traceId": trace_id,
                    "limit": 100,
                    "fields": "core,basic,usage,metadata,io,model",
                },
            )
            response.raise_for_status()
            rows = response.json()["data"]
            if len(rows) >= 5:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(
                    f"Trace ingestion incomplete: {len(rows)} observations"
                )
            time.sleep(2)
    generations = [r for r in rows if r["type"] == "GENERATION"]
    if len(generations) != 3 or sum(r["level"] == "ERROR" for r in generations) != 1:
        raise RuntimeError("Generation/error count mismatch")
    if any(r["usageDetails"].get("input_cached") != 30 for r in generations):
        raise RuntimeError("Cache usage mismatch")
    serialized = json.dumps(rows)
    if (
        "PRIVATE-SENTINEL" in serialized
        or "base64" in serialized
        or "mock-only-not-a-key" in serialized
    ):
        raise RuntimeError("Telemetry privacy failure")
    if any(
        r.get("input") is not None or r.get("output") is not None for r in generations
    ):
        raise RuntimeError("Default text capture must be off")
    print(
        json.dumps(
            {
                "trace_id": trace_id,
                "observations": len(rows),
                "generations": 3,
                "provider": "simulated HTTP; zero paid calls",
                "privacy": "passed",
                "estimated_cost_cny": [
                    r.get("metadata", {}).get("estimated_cost_cny") for r in generations
                ],
            }
        )
    )
    runtime.shutdown()


if __name__ == "__main__":
    main()
