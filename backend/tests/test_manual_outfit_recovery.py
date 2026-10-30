"""Manual snapshot restore and upgrade preservation in isolated databases only."""

import importlib.util
import json
from pathlib import Path
from uuid import UUID

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from test_backups import confirm, controls, export, validate  # noqa: F401
from test_manual_outfits import counts, payload, save
from test_outfits import client, generate, headers, session, wardrobe  # noqa: F401

from app.backup import control, workflow
from app.db.outfits import OutfitRevision
from app.db.session import get_engine, session_factory

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_manual_and_generated_snapshots_full_backup_roundtrip(wardrobe):  # noqa: F811
    ai, _ = generate(session())
    ai_revision = ai["revisions"][0]
    body, key = payload(wardrobe[:2], "wear"), headers()
    original = save(body, key).json()["data"]
    rid = original["revision"]["id"]
    edited = save({**payload(wardrobe[2:4]), "parent_revision_id": rid}).json()["data"]
    image = original["revision"]["items"][0]["image_url"]
    pixels = client.get(image).content
    fav = client.post("/api/v1/favorites", headers=headers(), json={"revision_id": rid}).json()[
        "data"
    ]
    _, path = export()
    ready = validate(path)
    assert ready.status == "ready", ready.message
    with session_factory().begin() as db:
        db.get(OutfitRevision, UUID(rid)).reason = "temporary test change"
    workflow.process(confirm(ready))
    assert control.require(ready.restore_id).status == "succeeded"
    assert client.get(f"/api/v1/outfit-revisions/{rid}").json()["data"] == original["revision"]
    assert (
        client.get(f"/api/v1/outfit-revisions/{edited['revision']['id']}").json()["data"]
        == edited["revision"]
    )
    assert client.get(f"/api/v1/outfit-revisions/{ai_revision['id']}").json()["data"] == ai_revision
    assert client.get("/api/v1/favorites").json()["data"]["items"][0] == fav
    assert client.get("/api/v1/wear-records").json()["data"]["items"][0] == original["wear"]
    assert client.get(image).content == pixels
    before = counts()
    assert save(body, key).json()["data"] == original
    assert counts() == before


def test_upgrade_keeps_all_original_revision_fields_and_image_references():
    generate(session())
    spec = importlib.util.spec_from_file_location(
        "manual_migration", Path("migrations/versions/0011_manual_outfits.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with get_engine().connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text("CREATE SCHEMA manual_upgrade_probe"))
            connection.execute(text("SET LOCAL search_path TO manual_upgrade_probe"))
            columns = (
                connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema='public' AND table_name='outfit_revisions' "
                        "AND column_name <> 'source' ORDER BY ordinal_position"
                    )
                )
                .scalars()
                .all()
            )
            # Identifiers come only from the local schema, never from uploaded backups.
            projection = ", ".join(columns)
            connection.execute(
                text(
                    f"CREATE TABLE outfit_revisions AS SELECT {projection} "
                    "FROM public.outfit_revisions"
                )
            )
            before = (
                connection.execute(
                    text("SELECT row_to_json(t) FROM outfit_revisions t ORDER BY id")
                )
                .scalars()
                .all()
            )
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
            after = (
                connection.execute(
                    text("SELECT row_to_json(t) FROM outfit_revisions t ORDER BY id")
                )
                .scalars()
                .all()
            )
            assert [row.pop("source") for row in after] == ["generated"] * len(before)
            assert json.dumps(after, sort_keys=True) == json.dumps(before, sort_keys=True)
        finally:
            transaction.rollback()
