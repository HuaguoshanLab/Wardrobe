"""Bounded, data-only archives; media is immutable and referenced explicitly."""

import hashlib
import json
import os
import shutil
import stat
from pathlib import Path, PurePosixPath
from zipfile import ZIP_STORED, ZipFile

from app.backup.database import DataSet, compatibility, export_data, load_data, media_keys
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import utcnow
from app.media.storage import path_for


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def safe_key(key: str) -> None:
    path = PurePosixPath(key)
    if (
        path.is_absolute()
        or ".." in path.parts
        or "\\" in key
        or str(path) != key
        or len(path.parts) != 2
    ):
        raise AppError("INVALID_BACKUP", "备份媒体路径无效")
    if path.parts[0] not in {"original", "display", "cutout", "excel"}:
        raise AppError("INVALID_BACKUP", "备份媒体目录无效")
    if len(path.parts[1]) != 32 or any(c not in "0123456789abcdef" for c in path.parts[1]):
        raise AppError("INVALID_BACKUP", "备份媒体文件名无效")


def export_archive(directory: Path, filename: str = "backup.zip") -> tuple[Path, dict[str, int]]:
    database = directory / "database.json"
    summary = export_data(database)
    data = load_data(database)
    files = {"database.json": database}
    for key in sorted(media_keys(data)):
        safe_key(key)
        source = path_for(key)
        if not source.is_file() or source.is_symlink():
            raise AppError("MEDIA_MISSING", "备份引用的媒体文件缺失")
        files[f"media/{key}"] = source
    if (
        len(files) > 10000
        or sum(p.stat().st_size for p in files.values()) > get_settings().backup_max_bytes - 1024**2
    ):
        raise AppError("BACKUP_LIMIT", "备份超过文件数量或总大小限制")
    manifest = {
        **compatibility(),
        "created_at": utcnow().isoformat(),
        "files": {
            name: {"size": path.stat().st_size, "sha256": sha256(path)}
            for name, path in files.items()
        },
    }
    temporary = directory / (filename + ".tmp")
    with ZipFile(temporary, "w", compression=ZIP_STORED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for name, path in files.items():
            archive.write(path, name)
    # fsync before publication (large archives are not loaded into memory).
    with temporary.open("rb") as stream:
        os.fsync(stream.fileno())
    if temporary.stat().st_size > get_settings().backup_max_bytes:
        temporary.unlink()
        raise AppError("BACKUP_LIMIT", "完整备份包超过大小限制")
    destination = directory / filename
    temporary.replace(destination)
    summary["media_files"] = len(files) - 1
    return destination, summary


def validate_archive(archive_path: Path, destination: Path) -> tuple[DataSet, dict[str, int]]:
    if archive_path.stat().st_size > get_settings().backup_max_bytes:
        raise AppError("BACKUP_LIMIT", "备份包超过大小限制")
    destination.mkdir(parents=True, exist_ok=True)
    with ZipFile(archive_path) as archive:
        entries = archive.infolist()
        names = [e.filename for e in entries]
        if len(entries) > 10001 or len(names) != len(set(names)) or "manifest.json" not in names:
            raise AppError("INVALID_BACKUP", "备份清单缺失、重名或文件数量超限")
        if archive.getinfo("manifest.json").file_size > 4 * 1024**2:
            raise AppError("BACKUP_LIMIT", "备份清单超限")
        if sum(e.file_size for e in entries) > get_settings().backup_max_bytes:
            raise AppError("BACKUP_LIMIT", "备份解压大小超限")
        manifest = json.loads(archive.read("manifest.json"))
        if any(manifest.get(k) != v for k, v in compatibility().items()):
            raise AppError("INCOMPATIBLE_BACKUP", "备份格式、应用或检查点版本不兼容")
        files = manifest.get("files")
        if (
            not isinstance(files, dict)
            or set(files) | {"manifest.json"} != set(names)
            or "database.json" not in files
        ):
            raise AppError("INVALID_BACKUP", "备份文件集合与清单不一致")
        for entry in entries:
            if entry.flag_bits & 1 or stat.S_ISLNK(entry.external_attr >> 16) or entry.is_dir():
                raise AppError("INVALID_BACKUP", "备份不接受加密、链接或目录条目")
            if entry.filename == "manifest.json":
                continue
            name = entry.filename
            if name != "database.json":
                if not name.startswith("media/"):
                    raise AppError("INVALID_BACKUP", "备份含未知文件")
                safe_key(name.removeprefix("media/"))
            elif entry.file_size > 128 * 1024**2:
                raise AppError("BACKUP_LIMIT", "数据库数据超限")
            meta = files[name]
            if not isinstance(meta, dict) or meta.get("size") != entry.file_size:
                raise AppError("INVALID_BACKUP", "文件大小与清单不符")
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output, length=1024**2)
            if sha256(target) != meta.get("sha256"):
                raise AppError("INVALID_BACKUP", "备份文件校验和错误")
    data = load_data(destination / "database.json")
    if {f"media/{k}" for k in media_keys(data)} != set(files) - {"database.json"}:
        raise AppError("INVALID_BACKUP", "备份图片引用与文件集合不一致")
    return data, {**{name: len(rows) for name, rows in data.items()}, "media_files": len(files) - 1}


def install_media(directory: Path, data: DataSet) -> None:
    # Stage files before the DB transaction. Existing immutable bytes are never overwritten.
    # On failure the old DB and all its media remain intact; extra files are unreferenced.
    for key in sorted(media_keys(data)):
        safe_key(key)
        source = directory / "media" / key
        target = path_for(key)
        if target.exists():
            if sha256(target) != sha256(source):
                raise AppError("MEDIA_COLLISION", "当前媒体与备份同名但内容不同，已拒绝覆盖")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(".restore-tmp")
        try:
            with source.open("rb") as incoming, temporary.open("wb") as outgoing:
                shutil.copyfileobj(incoming, outgoing, length=1024**2)
                outgoing.flush()
                os.fsync(outgoing.fileno())
            temporary.replace(target)
            descriptor = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        finally:
            temporary.unlink(missing_ok=True)
