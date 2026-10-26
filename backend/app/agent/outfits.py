from typing import TypedDict
from uuid import UUID

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from pydantic import ValidationError

from app.core.errors import AppError
from app.db.session import session_factory
from app.domain.outfits import target_constraints, validate_proposals
from app.jobs.queue import check_lease
from app.schemas.outfits import Intent, ModelOutfits, OutfitContext
from app.services.jobs import get_job
from app.services.outfits.calls import model_call
from app.services.outfits.commit import commit_result
from app.services.outfits.context import prepare_context


class OutfitState(TypedDict):
    job_id: str
    lease_token: str


def prepare(state: OutfitState) -> dict[str, str]:
    prepare_context(UUID(state["job_id"]), UUID(state["lease_token"]))
    return {}


def generate(state: OutfitState) -> dict[str, str]:
    job_id, token = UUID(state["job_id"]), UUID(state["lease_token"])
    with session_factory()() as db:
        job = get_job(db, job_id)
        if job.status == "succeeded" or job.provider_response is not None:
            return {}
        context = OutfitContext.model_validate(job.input_snapshot["context"])
        data = job.input_snapshot
        kind = job.kind
    intent: Intent | None = None
    if kind == "outfit_adjust":
        if data["scope"] == "chat":
            try:
                intent = Intent.model_validate(model_call(job_id, token, "intent", 0, context))
            except ValidationError as exc:
                raise AppError("INVALID_MODEL_OUTPUT", "模型返回了非法调整操作") from exc
            if intent.scope == "rebuild_unlocked" and not any(
                w in str(data.get("message")) for w in ["重搭", "重新搭配", "全套", "rebuild"]
            ):
                intent = Intent(
                    scope="clarify", question="是否要重搭全部未锁定单品？如只换某件，请明确目标。"
                )
        else:
            intent = Intent.model_validate(
                {"scope": data["scope"], "target_item_ids": data.get("target_item_ids", [])}
            )
        if intent.scope != "clarify":
            required, _ = target_constraints(context, intent)
            if not required <= {UUID(str(c["id"])) for c in context.candidates}:
                raise AppError("CONSTRAINT_CONFLICT", "需要保持的衣服已不可用，请调整目标范围")
    if intent and intent.scope == "clarify":
        output = ModelOutfits(message=intent.question or "请明确调整目标")
    elif not context.candidates:
        output = ModelOutfits(message="衣橱没有真实可用单品，请先上传衣服；示例不参与搭配。")
    else:
        correction = ""
        for attempt in range(2):
            try:
                raw = model_call(job_id, token, "outfits", attempt, context, intent, correction)
                output = validate_proposals(ModelOutfits.model_validate(raw), context, intent)
                break
            except (ValidationError, AppError) as exc:
                if isinstance(exc, AppError) and exc.code != "INVALID_MODEL_OUTPUT":
                    raise
                if attempt == 1:
                    raise AppError(
                        "INVALID_MODEL_OUTPUT", "模型结果仍违反约束，已停止；请调整条件后重试"
                    ) from exc
                correction = "上次结果未通过校验，请检查真实 ID、保持项、替换目标和数量。"
    with session_factory().begin() as db:
        job = get_job(db, job_id, lock=True)
        check_lease(job, token)
        job.provider_response = {
            "output": output.model_dump(mode="json"),
            "intent": intent.model_dump(mode="json") if intent else None,
        }
    return {}


def commit(state: OutfitState) -> dict[str, str]:
    commit_result(UUID(state["job_id"]), UUID(state["lease_token"]))
    return {}


def build_outfit_graph(
    saver: BaseCheckpointSaver[str], *, pause: bool = False
) -> CompiledStateGraph[OutfitState, None, OutfitState, OutfitState]:
    graph = StateGraph(OutfitState)
    graph.add_node("prepare", prepare)
    graph.add_node("generate", generate)
    graph.add_node("commit", commit)
    graph.add_edge(START, "prepare")
    graph.add_edge("prepare", "generate")
    graph.add_edge("generate", "commit")
    graph.add_edge("commit", END)
    return graph.compile(checkpointer=saver, interrupt_before=["commit"] if pause else None)
