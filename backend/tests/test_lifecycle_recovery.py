"""Lifecycle upgrade and backup roundtrip, only against the isolated test database."""

import json
from uuid import UUID

import pytest
from sqlalchemy import text
from test_backups import confirm, controls, export, validate  # noqa: F401
from test_lifecycle import act, history, read
from test_outfits import client, headers, wardrobe  # noqa: F401

from app.backup import control, database, workflow
from app.db.lifecycle import LifecycleEvent
from app.db.session import get_engine, session_factory

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_new_lifecycle_data_and_receipts_survive_full_restore(wardrobe):  # noqa: F811
    gid = wardrobe[0]
    subtype = client.post(
        "/api/v1/garment-subtypes",
        headers=headers(),
        json={"category": "top", "name": "恢复用衬衫"},
    ).json()["data"]
    assert act(gid, "profile", {"price": "39.90", "subtype_id": subtype["id"]}).status_code == 200
    assert act(gid, "storage", {"storage": "stored", "location": "二层"}).status_code == 200
    assert act(gid, "retire", {"exit_reason": "sold"}).status_code == 200
    exit_event = history(gid)["items"][0]
    assert (
        act(gid, "correct", related_event_id=exit_event["id"], reason="已收款").status_code == 200
    )
    item, events = read(gid), history(gid)
    pixels = client.get(item["image_url"]).content
    _, path = export()
    restored = validate(path)
    assert restored.status == "ready", restored.message
    assert (
        act(
            gid,
            "restore",
            {"availability": "available"},
            related_event_id=exit_event["id"],
            reason="测试恢复前变更",
        ).status_code
        == 200
    )
    workflow.process(confirm(restored))
    assert control.require(restored.restore_id).status == "succeeded"
    assert read(gid) == item and history(gid) == events
    assert client.get(item["image_url"]).content == pixels
    data_path = path.parent / "roundtrip.json"
    database.export_data(data_path)
    data = json.loads(data_path.read_text())
    assert data["public.garment_subtypes"]
    assert data["public.garment_events"]
    assert any(r["operation"] == f"lifecycle:{gid}" for r in data["public.operation_receipts"])


def test_migration_preserves_legacy_garments_and_unknowns(wardrobe):  # noqa: F811
    # New migration has no historic data transformation. Exercise its upgrade on a
    # temporary schema in one transaction; never downgrade the shared test schema.
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    spec = importlib.util.spec_from_file_location(
        "w1_migration", Path("migrations/versions/0007_lifecycle.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with get_engine().connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text("CREATE SCHEMA lifecycle_upgrade_probe"))
            connection.execute(text("SET LOCAL search_path TO lifecycle_upgrade_probe"))
            connection.execute(
                text(
                    "CREATE TABLE garments (id uuid PRIMARY KEY, attributes jsonb NOT NULL, "
                    "deleted_at timestamptz, version int NOT NULL, created_at timestamptz NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO garments SELECT id, attributes, deleted_at, version, created_at "
                    "FROM public.garments"
                )
            )
            before = connection.execute(
                text(
                    "SELECT id, attributes, version, created_at, deleted_at "
                    "FROM garments ORDER BY id"
                )
            ).all()
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
            after = connection.execute(
                text(
                    "SELECT id, attributes, version, created_at, deleted_at "
                    "FROM garments ORDER BY id"
                )
            ).all()
            assert before == after
            new = connection.execute(
                text("SELECT lifecycle, ownership, subtype_id FROM garments")
            ).all()
            assert all(row == ({}, "owned", None) for row in new)
        finally:
            transaction.rollback()


def test_cross_garment_correction_and_version_races_rejected(wardrobe):  # noqa: F811
    from concurrent.futures import ThreadPoolExecutor

    from test_lifecycle import TODAY

    first, second = wardrobe[:2]
    act(first, "storage", {"storage": "stored"})
    event = history(first)["items"][0]
    assert (
        act(second, "correct", related_event_id=event["id"], reason="错误引用").status_code == 422
    )
    version = read(second)["version"]

    def edit(storage):
        return client.post(
            f"/api/v1/garments/{second}/lifecycle",
            headers=headers(),
            json={
                "expected_version": version,
                "action": "storage",
                "occurred_on": TODAY,
                "changes": {"storage": storage},
            },
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(edit, ["stored", "daily"]))
    assert sorted(r.status_code for r in results) == [200, 409]
    with session_factory()() as db:
        assert db.get(LifecycleEvent, UUID(event["id"])).action == "storage"
