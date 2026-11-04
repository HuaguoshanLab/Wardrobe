import importlib.util
from pathlib import Path
from uuid import UUID

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from test_backups import confirm, controls, export, validate  # noqa: F401
from test_outfits import client, headers, wardrobe  # noqa: F401
from test_templates import ROOT, body, create, patch

from app.backup import control, database, workflow
from app.core.maintenance import exclusive
from app.db.session import get_engine, session_factory
from app.db.templates import ConditionTemplate

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_backup_restore_includes_templates_tombstones_and_receipts():
    key = headers()
    t = create(key=key)
    deleted = create({**body(), "name": "已删除"})
    client.request(
        "DELETE", ROOT + "/" + deleted["id"], json={"expected_version": 1}, headers=headers()
    )
    _, path = export()
    ready = validate(path)
    client.patch(ROOT + "/" + t["id"], json=patch(t, name="修改后"), headers=headers())
    workflow.process(confirm(ready))
    assert control.require(ready.restore_id).status == "succeeded"
    assert client.get(ROOT + "/" + t["id"]).json()["data"] == t
    assert create(key=key) == t
    with session_factory()() as db:
        assert db.get(ConditionTemplate, UUID(deleted["id"])).deleted_at is not None
    assert ("public", "condition_templates") in database.tables()
    with exclusive():
        assert client.get(ROOT).status_code == 503
        assert client.post(ROOT, json=body(), headers=headers()).status_code == 503


def test_additive_migration_preserves_all_existing_business_rows():
    spec = importlib.util.spec_from_file_location(
        "template_migration", Path("migrations/versions/0013_condition_templates.py")
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
            connection.execute(text("CREATE SCHEMA template_upgrade_probe"))
            connection.execute(text("SET LOCAL search_path TO template_upgrade_probe"))
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
            assert (
                connection.execute(text("SELECT count(*) FROM condition_templates")).scalar() == 0
            )
            assert (
                connection.execute(text("SELECT row_to_json(t) FROM public.garments t ORDER BY id"))
                .scalars()
                .all()
                == before
            )
        finally:
            transaction.rollback()


def test_old_backup_version_is_explicitly_rejected(tmp_path):
    import json
    from zipfile import ZipFile

    from app.backup import archive
    from app.core.errors import AppError

    _, path = export()
    old = tmp_path / "old.zip"
    with ZipFile(path) as source, ZipFile(old, "w") as target:
        for name in source.namelist():
            content = source.read(name)
            if name == "manifest.json":
                manifest = json.loads(content)
                manifest.update(app_version="0.7.3-feedback", alembic_revision="0012_wear_feedback")
                content = json.dumps(manifest).encode()
            target.writestr(name, content)
    with pytest.raises(AppError) as caught:
        archive.validate_archive(old, tmp_path / "extract")
    assert caught.value.code == "INCOMPATIBLE_BACKUP"
