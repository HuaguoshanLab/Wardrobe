import logging
import signal
import threading
from types import FrameType
from uuid import UUID

from app.agent.checkpoints import checkpointer
from app.agent.diagnostic import DiagnosticState, build_graph
from app.agent.outfits import OutfitState, build_outfit_graph
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.maintenance import shared
from app.jobs.imports import execute_import
from app.jobs.queue import claim, complete, heartbeat, sweep
from app.schemas.jobs import DiagnosticResult
from app.services.jobs import read_job

log = logging.getLogger(__name__)


def run_job(job_id: UUID, token: UUID) -> None:
    stop = threading.Event()

    def keep_alive() -> None:
        while not stop.wait(get_settings().lease_seconds / 3):
            try:
                if not heartbeat(job_id, token):
                    return
            except Exception:
                log.error("Heartbeat failed for job %s", job_id)
                return

    thread = threading.Thread(target=keep_alive, daemon=True)
    thread.start()
    try:
        if read_job(job_id).kind in {"outfit_generate", "outfit_adjust"}:
            from app.db.session import session_factory
            from app.services.jobs import get_job

            with session_factory()() as db:
                job = get_job(db, job_id)
                if job.status == "succeeded":
                    return
                session_id = str(job.input_snapshot["session_id"])
            with checkpointer() as saver:
                outfit_graph = build_outfit_graph(saver)
                outfit_state: OutfitState = {"job_id": str(job_id), "lease_token": str(token)}
                outfit_graph.invoke(
                    outfit_state,
                    {"configurable": {"thread_id": f"outfit:{session_id}"}, "recursion_limit": 12},
                )
            return
        if read_job(job_id).kind != "diagnostic":
            complete(job_id, token, execute_import(job_id, token))
            return
        with checkpointer() as saver:
            graph = build_graph(saver)
            state: DiagnosticState = {
                "job_id": str(job_id),
                "lease_token": str(token),
                "prepared": False,
                "message": "",
            }
            result = graph.invoke(
                state,
                {"configurable": {"thread_id": f"diagnostic:{job_id}"}, "recursion_limit": 12},
            )
            complete(job_id, token, DiagnosticResult(message=result["message"]).model_dump())
    except AppError as exc:
        complete(job_id, token, error={"code": exc.code, "message": exc.message})
    except Exception:
        log.error("Diagnostic execution failed for job %s", job_id)
        complete(job_id, token, error={"code": "EXECUTION_FAILED", "message": "任务执行失败"})
    finally:
        stop.set()
        thread.join(timeout=2)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    stop = threading.Event()

    def shutdown(signum: int, frame: FrameType | None) -> None:
        stop.set()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    while not stop.is_set():
        try:
            with shared():
                sweep()
                item = claim()
                if item:
                    run_job(*item)
            if not item:
                stop.wait(get_settings().poll_seconds)
        except AppError as exc:
            if exc.code != "MAINTENANCE_MODE":
                log.error("Worker error: %s", exc.code)
            stop.wait(get_settings().poll_seconds)
        except Exception:
            log.error("Worker database unavailable; retrying poll without rerunning a claimed job")
            stop.wait(2)


if __name__ == "__main__":
    main()
