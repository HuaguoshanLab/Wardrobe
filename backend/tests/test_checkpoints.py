from uuid import uuid4

import pytest

from app.agent.checkpoints import checkpointer
from app.agent.diagnostic import build_graph
from app.jobs.queue import claim
from app.schemas.jobs import DiagnosticInput
from app.services.jobs import create_job

pytestmark = pytest.mark.integration


def test_checkpoints_resume_with_new_connection_and_isolate_threads(clean_db: None) -> None:
    job = create_job(DiagnosticInput(message="检查点恢复", delay_seconds=0), str(uuid4()))
    item = claim()
    assert item
    config = {"configurable": {"thread_id": f"diagnostic:{job.id}"}}
    with checkpointer() as saver:
        graph = build_graph(saver, pause=True)
        graph.invoke(
            {"job_id": str(job.id), "lease_token": str(item[1]), "prepared": False, "message": ""},
            config,
        )
        assert graph.get_state(config).next == ("respond",)
    with checkpointer() as saver:
        graph = build_graph(saver)
        assert graph.get_state(config).values["prepared"] is True
        assert not graph.get_state({"configurable": {"thread_id": "another-session"}}).values
        result = graph.invoke(None, config)
        assert result["message"] == "模拟任务完成：检查点恢复"
        assert graph.get_state(config).next == ()


def test_persisted_response_is_reused_without_provider_call(
    clean_db: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.agent.diagnostic import respond
    from app.providers.fake import FakeProvider

    job = create_job(DiagnosticInput(delay_seconds=0), str(uuid4()))
    item = claim()
    assert item
    state = {"job_id": str(job.id), "lease_token": str(item[1]), "prepared": True, "message": ""}
    first = respond(state)

    def forbidden(*args: object) -> None:
        raise AssertionError("provider must not run again")

    monkeypatch.setattr(FakeProvider, "run", forbidden)
    assert respond(state) == first
