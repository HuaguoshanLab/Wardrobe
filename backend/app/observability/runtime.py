"""Fail-open manual spans: no automatic argument/exception capture or model retries."""

import hashlib
import logging
import re
import threading
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from functools import lru_cache, wraps
from typing import Literal, ParamSpec, TypeVar
from urllib.parse import urlsplit

from langfuse import Langfuse, propagate_attributes
from langfuse._client.span import LangfuseObservationWrapper
from langfuse.types import TraceContext
from opentelemetry.sdk.trace import TracerProvider
from pydantic import JsonValue

from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.observability import pricing, privacy

log = logging.getLogger(__name__)
_current: ContextVar["Observation | None"] = ContextVar("wardrobe_observation", default=None)
_warned: set[str] = set()
P = ParamSpec("P")
R = TypeVar("R")


def warning(code: str) -> None:
    if code not in _warned:
        _warned.add(code)
        log.warning("Observability unavailable: %s; business execution continues", code)


@lru_cache(maxsize=1)
def client() -> Langfuse | None:
    settings = get_settings()
    if not settings.langfuse_enabled:
        return None
    try:
        url = urlsplit(settings.langfuse_base_url)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or not settings.langfuse_public_key
            or not settings.langfuse_secret_key.get_secret_value()
        ):
            warning("INVALID_CONFIGURATION")
            return None
        return Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key.get_secret_value(),
            base_url=settings.langfuse_base_url,
            environment=settings.langfuse_environment,
            timeout=2,
            flush_at=32,
            flush_interval=2,
            tracer_provider=TracerProvider(shutdown_on_exit=False),
        )
    except Exception:
        warning("INITIALIZATION_FAILED")
        return None


class Observation:
    def __init__(self, span: LangfuseObservationWrapper | None = None) -> None:
        self.span = span

    def update(
        self,
        *,
        fields: Mapping[str, object] | None = None,
        level: Literal["DEFAULT", "WARNING", "ERROR"] = "DEFAULT",
        code: str | None = None,
        usage: dict[str, int] | None = None,
        cost: dict[str, float] | None = None,
        input_text: str | None = None,
        output_text: str | None = None,
    ) -> None:
        if self.span is None:
            return
        try:
            self.span.update(
                metadata=privacy.metadata(fields or {}),
                level=level,
                status_message=code,
                usage_details=usage or None,
                cost_details=cost or None,
                input=privacy.text(input_text) if input_text is not None else None,
                output=privacy.text(output_text) if output_text is not None else None,
            )
        except Exception:
            warning("UPDATE_FAILED")


def current() -> Observation:
    return _current.get() or Observation()


def step(name: str) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorate(fn: Callable[P, R]) -> Callable[P, R]:
        @wraps(fn)
        def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
            with observation(name):
                return fn(*args, **kwargs)

        return wrapped

    return decorate


def error_code(exc: BaseException) -> str:
    code = exc.code if isinstance(exc, AppError) else type(exc).__name__
    return code if re.fullmatch(r"[A-Za-z_]{1,80}", code) else "EXECUTION_ERROR"


@contextmanager
def observation(
    name: str,
    *,
    fields: Mapping[str, object] | None = None,
    generation: bool = False,
    model: str | None = None,
    version: str | None = None,
    job_id: str | None = None,
) -> Iterator[Observation]:
    span: LangfuseObservationWrapper | None = None
    try:
        sdk = client()
        parent = _current.get()
        trace: TraceContext | None = None
        if job_id:
            trace = {"trace_id": hashlib.sha256(f"wardrobe:{job_id}".encode()).hexdigest()[:32]}
        elif parent is not None and parent.span is not None:
            trace = {"trace_id": parent.span.trace_id, "parent_span_id": parent.span.id}
        if sdk:
            if generation:
                span = sdk.start_observation(
                    name=name,
                    as_type="generation",
                    trace_context=trace,
                    metadata=privacy.metadata(fields or {}),
                    model=model,
                    version=version,
                )
            else:
                span = sdk.start_observation(
                    name=name,
                    as_type="span",
                    trace_context=trace,
                    metadata=privacy.metadata(fields or {}),
                    version=version,
                )
    except Exception:
        warning("START_FAILED")
    handle = Observation(span)
    token = _current.set(handle)
    try:
        yield handle
    except BaseException as exc:
        handle.update(level="ERROR", code=error_code(exc))
        raise
    finally:
        _current.reset(token)
        if span is not None:
            try:
                span.end()
            except Exception:
                warning("END_FAILED")


@contextmanager
def session(session_id: str | None) -> Iterator[None]:
    """Attach only a stable ID; never pass a database object or graph state to the SDK."""
    context = None
    try:
        if client() and session_id:
            context = propagate_attributes(session_id=session_id)
            context.__enter__()
    except Exception:
        context = None
        warning("SESSION_FAILED")
    try:
        yield
    finally:
        if context is not None:
            try:
                context.__exit__(None, None, None)
            except Exception:
                warning("SESSION_END_FAILED")


def model_input(request: Mapping[str, JsonValue], step: str, settings: Settings) -> None:
    if not settings.langfuse_capture_text:
        return
    try:
        current().update(input_text=privacy.outfit_input(request, step))
    except Exception:
        warning("INPUT_CAPTURE_FAILED")


def model_response(raw: object, settings: Settings) -> None:
    """Capture usage before parsing model content, including schema-invalid responses."""
    if not isinstance(raw, dict):
        return
    try:
        usage = privacy.usage(raw.get("usage"))
        cost_fields, costs = pricing.estimate(usage, settings)
        fields: dict[str, object] = {"usage_available": bool(usage), **cost_fields}
        content = None
        choices = raw.get("choices")
        if isinstance(choices, list) and choices and isinstance(choices[0], dict):
            message = choices[0].get("message")
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                content = message["content"]
                fields["output_chars"] = len(content)
        current().update(
            fields=fields,
            usage=usage,
            cost=costs,
            output_text=content if settings.langfuse_capture_text else None,
        )
    except Exception:
        warning("RESPONSE_CAPTURE_FAILED")


def shutdown(timeout: float = 5) -> None:
    """Bound shutdown work; SIGKILL can still lose queued telemetry, never business data."""
    sdk = client()
    if sdk is None:
        return

    def finish() -> None:
        try:
            sdk.shutdown()
        except Exception:
            warning("SHUTDOWN_FAILED")

    thread = threading.Thread(target=finish, name="langfuse-shutdown", daemon=True)
    thread.start()
    thread.join(timeout=timeout)
    if thread.is_alive():
        warning("SHUTDOWN_TIMEOUT")
