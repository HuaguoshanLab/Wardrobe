from typing import TypedDict
from uuid import UUID

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.core.errors import AppError
from app.db.session import session_factory
from app.jobs.queue import check_lease
from app.providers.fake import FakeProvider
from app.schemas.jobs import DiagnosticInput, DiagnosticResult
from app.services.jobs import append_event, get_job


class DiagnosticState(TypedDict):
    job_id: str
    lease_token: str
    prepared: bool
    message: str


def prepare(state: DiagnosticState) -> dict[str, bool]:
    with session_factory().begin() as db:
        job = get_job(db, UUID(state["job_id"]), lock=True)
        check_lease(job, UUID(state["lease_token"]))
        append_event(db, job, "progress", {"stage": "prepared", "message": "已读取持久化任务"})
    return {"prepared": True}


def respond(state: DiagnosticState) -> dict[str, str]:
    job_id, token = UUID(state["job_id"]), UUID(state["lease_token"])
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        if job.provider_response is not None:
            return {"message": DiagnosticResult.model_validate(job.provider_response).message}
        if job.call_state == "sent":
            raise AppError("CALL_RESULT_UNKNOWN", "上次调用结果未知，请显式重试")
        payload = DiagnosticInput.model_validate(job.input_snapshot)
        job.call_state = "sent"
    response = FakeProvider().run(payload)
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        job.provider_response, job.call_state = response.model_dump(mode="json"), "received"
    return {"message": response.message}


def build_graph(
    saver: BaseCheckpointSaver[str], *, pause: bool = False
) -> CompiledStateGraph[DiagnosticState, None, DiagnosticState, DiagnosticState]:
    graph = StateGraph(DiagnosticState)
    graph.add_node("prepare", prepare)
    graph.add_node("respond", respond)
    graph.add_edge(START, "prepare")
    graph.add_edge("prepare", "respond")
    graph.add_edge("respond", END)
    return graph.compile(checkpointer=saver, interrupt_before=["respond"] if pause else None)
