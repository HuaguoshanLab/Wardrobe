import asyncio
from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request
from sse_starlette import EventSourceResponse, ServerSentEvent

from app.core.errors import AppError, request_id
from app.schemas.common import Envelope
from app.schemas.jobs import DiagnosticInput, EventView, JobAccepted, JobView
from app.services.jobs import cancel_job, create_job, read_events, read_job, retry_job

router = APIRouter()
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]


@router.post("/diagnostics/jobs", status_code=202, response_model=Envelope[JobAccepted])
def submit(
    request: Request, payload: DiagnosticInput, idempotency_key: Key
) -> Envelope[JobAccepted]:
    job = create_job(payload, idempotency_key)
    return Envelope(
        data=JobAccepted(job_id=job.id, status=job.status), request_id=request_id(request)
    )


@router.get("/jobs/{job_id}", response_model=Envelope[JobView])
def get(request: Request, job_id: UUID) -> Envelope[JobView]:
    return Envelope(data=read_job(job_id), request_id=request_id(request))


@router.post("/jobs/{job_id}/cancel", response_model=Envelope[JobView])
def cancel(request: Request, job_id: UUID) -> Envelope[JobView]:
    return Envelope(data=cancel_job(job_id), request_id=request_id(request))


@router.post("/jobs/{job_id}/retry", status_code=202, response_model=Envelope[JobAccepted])
def retry(request: Request, job_id: UUID, idempotency_key: Key) -> Envelope[JobAccepted]:
    job = retry_job(job_id, idempotency_key)
    return Envelope(
        data=JobAccepted(job_id=job.id, status=job.status), request_id=request_id(request)
    )


@router.get(
    "/jobs/{job_id}/events",
    responses={
        200: {
            "description": "Read-only SSE; each data field is an EventView",
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
        }
    },
)
async def events(
    job_id: UUID,
    request: Request,
    after_seq: Annotated[int | None, Query(ge=0)] = None,
    last_event_id: Annotated[int | None, Header(ge=0)] = None,
) -> EventSourceResponse:
    if after_seq is not None and last_event_id is not None and after_seq != last_event_id:
        raise AppError("INVALID_EVENT_CURSOR", "两个事件游标不一致", 422)
    cursor = after_seq if after_seq is not None else last_event_id or 0
    initial = await asyncio.to_thread(read_events, job_id, cursor)

    async def stream() -> AsyncIterator[ServerSentEvent]:
        after = cursor
        batch, done = initial
        while not await request.is_disconnected():
            for event in batch:
                yield ServerSentEvent(
                    data=event.model_dump_json(), event=event.type, id=str(event.seq)
                )
                after = event.seq
            if done:
                return
            await asyncio.sleep(0.25)
            try:
                batch, done = await asyncio.to_thread(read_events, job_id, after)
            except AppError as exc:
                # No synthetic seq: clients query the durable Job on a stream failure.
                yield ServerSentEvent(event="stream_error", data=exc.code)
                return

    return EventSourceResponse(stream(), ping=15, headers={"X-Accel-Buffering": "no"})


# Export this schema even though HTTP transports its instances inside SSE data.
EVENT_SCHEMA = EventView
