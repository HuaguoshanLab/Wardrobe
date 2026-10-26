from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.rows import dict_row

from app.core.config import get_settings


@contextmanager
def checkpointer() -> Iterator[PostgresSaver]:
    with psycopg.connect(
        get_settings().psycopg_url,
        autocommit=True,
        row_factory=dict_row,
        options="-c search_path=checkpoints",
        prepare_threshold=0,
        connect_timeout=5,
    ) as connection:
        yield PostgresSaver(connection)


def setup_checkpoints() -> None:
    with psycopg.connect(get_settings().psycopg_url, autocommit=True) as connection:
        connection.execute("CREATE SCHEMA IF NOT EXISTS checkpoints")
    with checkpointer() as saver:
        saver.setup()
