"""W3 migration and backup are verified against the dedicated test database only."""

import importlib.util
from pathlib import Path
from uuid import UUID

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text
from test_backups import confirm, controls, export, validate  # noqa: F401
from test_inventory import demand, prepare, save
from test_organization import board, decide, preview, process
from test_outfits import client, wardrobe  # noqa: F401
from test_supply import associate, make

from app.backup import control, database, workflow
from app.db.organization import OrganizationDecision
from app.db.session import get_engine, session_factory

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_w3_full_restore_sources_partial_links_decisions_and_events(wardrobe):  # noqa: F811
    prepare(wardrobe)
    row = demand(lower=0, upper=0)
    save([row])
    plan = make(source_ids=[row["id"]])
    assert associate(plan, wardrobe[0]).status_code == 200
    c = board()["candidates"][0]
    assert decide(c, "keep").status_code == 200
    other = next(g for g in wardrobe[:2] if str(g) != c["garment_id"])
    assert process(other, preview(other)).status_code == 200
    supply_before = client.get(f"/api/v1/supply-plans/{plan['id']}").json()["data"]
    decisions_before = board("all")["candidates"]
    _, path = export()
    staged = validate(path)
    assert staged.status == "ready", staged.message
    save([])
    with session_factory().begin() as db:
        db.scalar(
            select(OrganizationDecision).where(OrganizationDecision.state == "keep")
        ).note = "changed"
    workflow.process(confirm(staged))
    assert control.require(staged.restore_id).status == "succeeded"
    assert client.get(f"/api/v1/supply-plans/{plan['id']}").json()["data"] == supply_before
    assert board("all")["candidates"] == decisions_before
    data_file = path.parent / "w3-roundtrip.json"
    database.export_data(data_file)
    data = database.load_data(data_file)
    for table in ["supply_plans", "supply_sources", "supply_links", "organization_decisions"]:
        assert data[f"public.{table}"]
    assert any(r["action"] == "retire" for r in data["public.garment_events"])


def test_migration_only_adds_tables_and_preserves_w2_sources(wardrobe):  # noqa: F811
    spec = importlib.util.spec_from_file_location(
        "w3_migration", Path("migrations/versions/0009_organization.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with get_engine().connect() as connection:
        tx = connection.begin()
        try:
            connection.execute(text("CREATE SCHEMA organization_upgrade_probe"))
            connection.execute(text("SET LOCAL search_path TO organization_upgrade_probe"))
            for name in ["garments", "inventory_demands"]:
                connection.execute(text(f"CREATE TABLE {name} (id uuid PRIMARY KEY, data jsonb)"))
                connection.execute(
                    text(f"INSERT INTO {name} VALUES (:id, CAST(:data AS jsonb))"),
                    {"id": UUID(str(wardrobe[0])), "data": '{"unknown":null}'},
                )
            before = connection.execute(text("SELECT * FROM garments")).all()
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
            assert connection.execute(text("SELECT * FROM garments")).all() == before
            assert connection.execute(text("SELECT * FROM inventory_demands")).all() == before
            for name in [
                "supply_plans",
                "supply_sources",
                "supply_links",
                "organization_decisions",
            ]:
                assert connection.scalar(text(f"SELECT count(*) FROM {name}")) == 0
        finally:
            tx.rollback()
