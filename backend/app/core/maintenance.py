"""Cross-process barrier shared by API, worker and the backup controller."""

import fcntl
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import AppError


def control_root() -> Path:
    root = get_settings().control_root
    root.mkdir(parents=True, exist_ok=True)
    return root


def active() -> bool:
    return (control_root() / "maintenance").exists()


@contextmanager
def shared() -> Iterator[None]:
    with (control_root() / "barrier.lock").open("a+b") as lock:
        if active():
            raise AppError("MAINTENANCE_MODE", "正在备份或恢复，请稍后再操作", 503)
        try:
            fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise AppError("MAINTENANCE_MODE", "数据维护中，请稍后再操作", 503) from exc
        try:
            if active():
                raise AppError("MAINTENANCE_MODE", "数据维护中，请稍后再操作", 503)
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


@contextmanager
def exclusive(timeout: float = 330) -> Iterator[None]:
    marker = control_root() / "maintenance"
    marker.touch()
    try:
        with (control_root() / "barrier.lock").open("a+b") as lock:
            end = time.monotonic() + timeout
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= end:
                        raise AppError(
                            "MAINTENANCE_TIMEOUT", "已有操作未能在期限内静止，维护失败"
                        ) from None
                    time.sleep(0.1)
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)
    finally:
        marker.unlink(missing_ok=True)
