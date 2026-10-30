import importlib.util
from pathlib import Path
from uuid import UUID

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from test_backups import confirm, controls, export, validate  # noqa: F401
from test_feedback import body, path, record
from test_outfits import client, headers, wardrobe  # noqa: F401

from app.backup import control, database, workflow
from app.core.maintenance import exclusive
from app.db.feedback import WearFeedback
from app.db.session import get_engine, session_factory

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_feedback_backup_restore_replay_and_maintenance(wardrobe):  # noqa: F811
    wear = record(wardrobe[:2])
    key = headers()
    original = client.patch(path(wear), headers=key, json=body()).json()["data"]
    with exclusive():
        blocked = client.patch(path(wear), headers=headers(), json=body(1))
        assert blocked.status_code == 503
    _, archive = export()
    ready = validate(archive)
    assert ready.status == "ready", ready.message
    with session_factory().begin() as db:
        db.delete(db.get(WearFeedback, UUID(wear["id"])))
    workflow.process(confirm(ready))
    assert control.require(ready.restore_id).status == "succeeded"
    assert client.get(path(wear)).json()["data"] == original
    assert client.patch(path(wear), headers=key, json=body()).json()["data"] == original
    assert ("public", "wear_feedback") in database.tables()


def test_additive_migration_preserves_existing_records(wardrobe):  # noqa: F811
    record(wardrobe[:1])
    spec = importlib.util.spec_from_file_location(
        "feedback_migration", Path("migrations/versions/0012_wear_feedback.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with get_engine().connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text("CREATE SCHEMA feedback_upgrade_probe"))
            connection.execute(text("SET LOCAL search_path TO feedback_upgrade_probe"))
            connection.execute(
                text("CREATE TABLE wear_records AS SELECT * FROM public.wear_records")
            )
            connection.execute(text("ALTER TABLE wear_records ADD PRIMARY KEY (id)"))
            before = (
                connection.execute(text("SELECT row_to_json(t) FROM wear_records t ORDER BY id"))
                .scalars()
                .all()
            )
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
            after = (
                connection.execute(text("SELECT row_to_json(t) FROM wear_records t ORDER BY id"))
                .scalars()
                .all()
            )
            assert before == after
            assert connection.execute(text("SELECT count(*) FROM wear_feedback")).scalar() == 0
        finally:
            transaction.rollback()
