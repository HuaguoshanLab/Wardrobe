"""Separate durable controller; never claims normal business jobs."""

import fcntl
import logging
import signal
import threading

from app.backup import control, workflow
from app.core.maintenance import control_root, exclusive

log = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    with (control_root() / "controller.lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        initialized = False
        while not stop.is_set():
            try:
                if not initialized:
                    # A persistent maintenance marker survives SIGKILL until this audit completes.
                    with exclusive():
                        for record in control.all_records():
                            if record.status == "running" or (
                                record.status == "validating" and record.phase == "validating"
                            ):
                                workflow.recover(record)
                    initialized = True
                for record in control.all_records():
                    if record.status in {"queued", "validating"}:
                        workflow.process(record)
            except Exception:
                log.error("Maintenance controller unavailable; retaining recovery gate")
                (control_root() / "maintenance").touch()
                initialized = False
            stop.wait(0.5)


if __name__ == "__main__":
    main()
