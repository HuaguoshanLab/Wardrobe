import importlib.util
from pathlib import Path
from uuid import UUID

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from test_backups import confirm, controls, export, validate  # noqa: F401
from test_outfits import client, headers, wardrobe  # noqa: F401
from test_reference import ROOT, confirmed, create, read, run

from app.backup import control, database, workflow
from app.db.reference import Reference
from app.db.session import get_engine, session_factory

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_archive_reference_photos_snapshots_tombstones_pending_and_receipts():
    row, _ = run(confirmed(), "generate")
    original = read(row)
    deleted = create()
    client.request(
        "DELETE", f"{ROOT}/{deleted['id']}", json={"expected_version": 1}, headers=headers()
    )
    row, pending = run(row, "analyze", False)
    _, path = export()
    ready = validate(path)
    row = read(row)
    client.patch(
        f"{ROOT}/{row['id']}",
        json={"expected_version": row["version"], "clues": []},
        headers=headers(),
    )
    epoch = database.data_epoch()
    workflow.process(confirm(ready))
    assert control.require(ready.restore_id).status == "succeeded"
    assert database.data_epoch() != epoch
    restored = read(row)
    assert restored["clues"] == original["clues"]
    assert restored["revision_ids"] == original["revision_ids"]
    assert client.get(row["image_url"]).status_code == 200
    assert client.get(deleted["image_url"]).status_code == 404
    assert client.get("/api/v1/jobs/" + pending["id"]).json()["data"]["status"] == "interrupted"
    with session_factory()() as db:
        assert db.get(Reference, UUID(deleted["id"])).deleted_at


def test_additive_reference_migration():
    spec = importlib.util.spec_from_file_location(
        "reference_migration", Path("migrations/versions/0015_reference.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with get_engine().connect() as connection:
        transaction = connection.begin()
        try:
            before = (
                connection.execute(text("SELECT row_to_json(t) FROM public.garments t ORDER BY id"))
                .scalars()
                .all()
            )
            connection.execute(text("CREATE SCHEMA reference_upgrade_probe"))
            connection.execute(text("SET LOCAL search_path TO reference_upgrade_probe, public"))
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
                assert (
                    connection.execute(text("SELECT count(*) FROM outfit_references")).scalar() == 0
                )
                module.downgrade()
            assert (
                connection.execute(text("SELECT row_to_json(t) FROM public.garments t ORDER BY id"))
                .scalars()
                .all()
                == before
            )
        finally:
            transaction.rollback()
