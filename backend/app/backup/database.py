"""Data-only PostgreSQL export/import. Uploaded backups never supply SQL or DDL."""

import json
import os
import subprocess
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from importlib.metadata import version
from pathlib import Path
from uuid import UUID

import psycopg
from psycopg import sql
from psycopg.types.json import Json
from pydantic import JsonValue, TypeAdapter
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.core.errors import AppError
from app.db import collections, outfits, profile, wardrobe  # noqa: F401
from app.db.models import Base
from app.schemas.outfits import ItemSnapshot

DataSet = dict[str, list[dict[str, JsonValue]]]

REVISION = "0005_collections"
CHECKPOINT_TABLES = [
    "checkpoint_migrations",
    "checkpoints",
    "checkpoint_blobs",
    "checkpoint_writes",
]


def compatibility() -> dict[str, str | int]:
    return {
        "format_version": 1,
        "app_version": "0.1.0-p5",
        "alembic_revision": REVISION,
        "checkpoint_adapter": version("langgraph-checkpoint-postgres"),
    }


def tables() -> list[tuple[str, str]]:
    return (
        [("public", "alembic_version")]
        + [("public", t.name) for t in Base.metadata.sorted_tables]
        + [("checkpoints", n) for n in CHECKPOINT_TABLES]
    )


def connection_url(database: str | None = None) -> str:
    url = make_url(get_settings().database_url).set(drivername="postgresql")
    if database:
        url = url.set(database=database)
    return url.render_as_string(hide_password=False)


def export_data(destination: Path) -> dict[str, int]:
    data = {}
    with psycopg.connect(connection_url()) as connection:
        for schema, name in tables():
            rows = connection.execute(
                sql.SQL("SELECT row_to_json(t) FROM {} t").format(sql.Identifier(schema, name))
            ).fetchall()
            data[f"{schema}.{name}"] = [row[0] for row in rows]
    encoded = json.dumps(data, ensure_ascii=False).encode()
    if len(encoded) > 128 * 1024**2:
        raise AppError("BACKUP_LIMIT", "数据库逻辑数据超过 128 MiB 限额")
    destination.write_bytes(encoded)
    return {name: len(rows) for name, rows in data.items()}


def load_data(path: Path) -> DataSet:
    if path.stat().st_size > 128 * 1024**2:
        raise AppError("BACKUP_LIMIT", "数据库数据超限")
    data = TypeAdapter(DataSet).validate_python(json.loads(path.read_bytes()))
    expected = {f"{s}.{n}" for s, n in tables()}
    if not isinstance(data, dict) or data.keys() != expected:
        raise AppError("INVALID_BACKUP", "备份表集合不匹配")
    for rows in data.values():
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise AppError("INVALID_BACKUP", "备份行格式错误")
    if data["public.alembic_version"] != [{"version_num": REVISION}]:
        raise AppError("INCOMPATIBLE_BACKUP", "备份迁移版本不兼容")
    if len(data["public.system_state"]) != 1 or data["public.system_state"][0]["id"] != 1:
        raise AppError("INVALID_BACKUP", "缺少唯一系统状态")
    return data


def import_data(connection: psycopg.Connection, data: DataSet) -> None:
    names = tables()
    connection.execute(
        sql.SQL("TRUNCATE {} RESTART IDENTITY").format(
            sql.SQL(", ").join(sql.Identifier(s, n) for s, n in names)
        )
    )
    for schema, name in names:
        rows = data[f"{schema}.{name}"]
        columns = {
            r[0]
            for r in connection.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema=%s AND table_name=%s",
                (schema, name),
            )
        }
        if any(row.keys() != columns for row in rows):
            raise AppError("INVALID_BACKUP", "备份字段不匹配")
        if rows:
            connection.execute(
                sql.SQL(
                    "INSERT INTO {} SELECT * FROM json_populate_recordset(NULL::{}, %s)"
                ).format(sql.Identifier(schema, name), sql.Identifier(schema, name)),
                (Json(rows),),
            )


def media_keys(data: DataSet) -> set[str]:
    keys = {
        str(row[k])
        for row in data["public.media_assets"]
        for k in ("original_key", "display_key", "cutout_key")
        if row[k]
    }
    keys.update(
        str(row["source_key"]) for row in data["public.import_batches"] if row["source_key"]
    )
    keys.update(str(row["storage_key"]) for row in data["public.outfit_images"])
    images = {str(row["id"]) for row in data["public.outfit_images"]}
    for revision in data["public.outfit_revisions"]:
        items = revision["items"]
        if not isinstance(items, list):
            raise AppError("INVALID_BACKUP", "历史快照格式无效")
        for value in items:
            item = ItemSnapshot.model_validate(value)
            if item.source == "wardrobe" and str(item.display_asset_id) not in images:
                raise AppError("INVALID_BACKUP", "历史图片引用缺失")
    return keys


def drop_stage(name: str) -> None:
    if not name.startswith("wardrobe_restore_") or len(name) != len("wardrobe_restore_") + 32:
        raise AppError("INVALID_STAGE", "隔离数据库名称无效")
    UUID(name.removeprefix("wardrobe_restore_"))
    with psycopg.connect(connection_url("postgres"), autocommit=True) as admin:
        admin.execute(
            sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
        )


@contextmanager
def staging(name: str, directory: Path) -> Iterator[str]:
    drop_stage(name)
    with psycopg.connect(connection_url("postgres"), autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    try:
        env = {
            **os.environ,
            "WARDROBE_DATABASE_URL": make_url(get_settings().database_url)
            .set(database=name)
            .render_as_string(hide_password=False),
            "WARDROBE_MEDIA_ROOT": str(directory / "seed-media"),
            "WARDROBE_CONTROL_ROOT": str(directory / "seed-control"),
        }
        # Trusted local migrations and adapter setup only; no SQL from the archive.
        code = (
            "from alembic import command; from alembic.config import Config; "
            "from app.agent.checkpoints import setup_checkpoints; "
            "command.upgrade(Config('alembic.ini'), 'head'); setup_checkpoints()"
        )
        result = subprocess.run(
            [sys.executable, "-c", code], env=env, capture_output=True, timeout=120
        )
        if result.returncode:
            raise AppError("STAGING_FAILED", "隔离数据库初始化失败")
        yield connection_url(name)
    finally:
        drop_stage(name)


def data_epoch() -> UUID:
    with psycopg.connect(connection_url()) as connection:
        row = connection.execute("SELECT data_epoch FROM system_state WHERE id=1").fetchone()
        if row is None:
            raise AppError("NOT_INITIALIZED", "系统状态缺失")
        return UUID(str(row[0]))


def switch_data(data: DataSet, epoch: UUID) -> None:
    with psycopg.connect(connection_url()) as connection:
        import_data(connection, data)
        # Keep a valid event history, but never replay backed-up work.
        connection.execute("""UPDATE jobs SET status='interrupted', lease_token=NULL,
            error='{"code":"RESTORED_INTERRUPTED","message":"从备份恢复，请显式重试"}'::jsonb,
            last_seq=last_seq+2, updated_at=now()
            WHERE status IN ('queued','running','cancel_requested')""")
        connection.execute("""INSERT INTO job_events(job_id,seq,type,payload,occurred_at)
            SELECT id,last_seq-1,'error',error,now() FROM jobs
            WHERE error->>'code'='RESTORED_INTERRUPTED'
            ON CONFLICT DO NOTHING""")
        connection.execute("""INSERT INTO job_events(job_id,seq,type,payload,occurred_at)
            SELECT id,last_seq,'status','{"status":"interrupted"}'::jsonb,now() FROM jobs
            WHERE error->>'code'='RESTORED_INTERRUPTED'
            ON CONFLICT DO NOTHING""")
        connection.execute("UPDATE system_state SET data_epoch=%s WHERE id=1", (epoch,))
