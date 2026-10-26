import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.errors import AppError
from app.db.models import Job, JobEvent, utcnow
from app.db.session import session_factory
from app.jobs.queue import claim, complete, heartbeat, sweep
from app.jobs.worker import run_job
from app.main import app
from app.schemas.jobs import DiagnosticInput, JobView
from app.services.jobs import cancel_job, create_job, read_job, retry_job

pytestmark = pytest.mark.integration


def create(**kwargs: object) -> JobView:
    return create_job(DiagnosticInput.model_validate({"delay_seconds": 0, **kwargs}), str(uuid4()))


def test_concurrent_idempotency_and_content_conflict(clean_db: None) -> None:
    key = str(uuid4())
    with ThreadPoolExecutor(max_workers=4) as pool:
        ids = list(pool.map(lambda _: create_job(DiagnosticInput(), key).id, range(4)))
    assert len(set(ids)) == 1
    with pytest.raises(AppError) as exc:
        create_job(DiagnosticInput(message="different"), key)
    assert exc.value.code == "IDEMPOTENCY_CONFLICT"


def test_only_one_worker_claims_job(clean_db: None) -> None:
    create()
    with ThreadPoolExecutor(max_workers=4) as pool:
        claims = list(pool.map(lambda _: claim(), range(4)))
    assert len([item for item in claims if item]) == 1


def test_success_and_sse_replay_never_reexecutes(clean_db: None) -> None:
    job = create(message="原始消息")
    item = claim()
    assert item
    run_job(*item)
    client = TestClient(app)
    state = client.get(f"/api/v1/jobs/{job.id}").json()["data"]
    assert state["status"] == "succeeded"
    assert state["result"]["provider_mode"] == "fake"
    response = client.get(f"/api/v1/jobs/{job.id}/events?after_seq=1")
    events = [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]
    assert [e["seq"] for e in events] == list(range(2, state["last_seq"] + 1))
    assert events[-1]["payload"]["status"] == "succeeded"
    assert client.get(f"/api/v1/jobs/{job.id}/events?after_seq={state['last_seq']}").text == ""
    assert read_job(job.id).last_seq == state["last_seq"]
    assert claim() is None


def test_cancel_wins_and_success_wins_are_both_consistent(clean_db: None) -> None:
    first = create()
    item = claim()
    assert item
    cancel_job(first.id)
    complete(*item, result={"provider_mode": "fake", "message": "late"})
    assert read_job(first.id).status == "cancelled"
    assert read_job(first.id).result is None
    second = create()
    item = claim()
    assert item
    complete(*item, result={"provider_mode": "fake", "message": "done"})
    assert cancel_job(second.id).status == "succeeded"


def test_expired_lease_is_fenced_and_not_automatically_requeued(clean_db: None) -> None:
    job = create()
    item = claim()
    assert item
    with session_factory().begin() as db:
        stored = db.get(Job, job.id)
        stored.heartbeat_at = utcnow() - timedelta(minutes=10)
    sweep()
    assert heartbeat(*item) is False
    complete(*item, result={"provider_mode": "fake", "message": "late"})
    assert read_job(job.id).status == "interrupted"
    assert claim() is None
    new = retry_job(job.id, "explicit-retry")
    assert new.id != job.id
    assert new.retry_of_job_id == job.id
    assert retry_job(job.id, "explicit-retry").id == new.id


def test_failed_fake_can_be_retried_explicitly(clean_db: None) -> None:
    job = create(scenario="failure")
    item = claim()
    assert item
    run_job(*item)
    assert read_job(job.id).status == "failed"
    assert read_job(job.id).error.code == "FAKE_FAILURE"
    assert retry_job(job.id, "new-attempt").status == "queued"


def test_queued_cancel_prevents_execution(clean_db: None) -> None:
    job = create()
    assert cancel_job(job.id).status == "cancelled"
    assert cancel_job(job.id).status == "cancelled"
    assert claim() is None


def test_unknown_call_is_interrupted_not_reissued(clean_db: None) -> None:
    job = create()
    item = claim()
    assert item
    with session_factory().begin() as db:
        stored = db.get(Job, job.id)
        stored.call_state = "sent"
    run_job(*item)
    state = read_job(job.id)
    assert state.status == "interrupted"
    assert state.error.code == "CALL_RESULT_UNKNOWN"
    assert state.result is None


def test_expired_or_invalid_cursor_returns_actionable_error(clean_db: None) -> None:
    job = create()
    client = TestClient(app)
    path = f"/api/v1/jobs/{job.id}/events"
    assert client.get(path + "?after_seq=99").status_code == 422
    assert client.get(path + "?after_seq=0", headers={"Last-Event-ID": "1"}).status_code == 422
    with session_factory().begin() as db:
        db.execute(delete(JobEvent).where(JobEvent.job_id == job.id))
    response = client.get(path)
    assert response.status_code == 410
    assert response.json()["error"]["code"] == "EVENT_CURSOR_EXPIRED"


def test_ready_and_capability_survive_reinitialization(clean_db: None) -> None:
    client = TestClient(app)
    assert client.get("/api/v1/health/ready").status_code == 200
    state = client.get("/api/v1/capabilities").json()["data"]
    assert state["model"] == "fake"
    with session_factory()() as db:
        assert db.scalar(select(Job.id)) is None
