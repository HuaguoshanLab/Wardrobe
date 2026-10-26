import hashlib
import os
from pathlib import Path
from uuid import uuid4

from app.core.config import get_settings
from app.core.errors import AppError


def path_for(key: str) -> Path:
    root = get_settings().media_root.resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root):
        raise AppError("INVALID_MEDIA_PATH", "图片路径无效", 400)
    return path


def store_bytes(data: bytes, group: str = "original") -> tuple[str, str]:
    key = f"{group}/{uuid4().hex}"
    path = path_for(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    return key, hashlib.sha256(data).hexdigest()


def remove_keys(keys: list[str]) -> None:
    for key in keys:
        path_for(key).unlink(missing_ok=True)
