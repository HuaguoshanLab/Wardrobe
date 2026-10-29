import importlib.util
from pathlib import Path
from uuid import UUID

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from test_backups import confirm, controls, export, validate  # noqa: F401
from test_inventory import demand, read, save
from test_inventory_subtypes import subtype
from test_outfits import client, wardrobe  # noqa: F401

from app.backup import control, workflow
from app.db.lifecycle import GarmentSubtype
from app.db.session import get_engine, session_factory

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_w2_configuration_subtypes_and_receipts_survive_full_restore():
    s = subtype()
    row = demand(subtype_ids=[s["id"]], lower=0, upper=0)
    save([row])
    before = read()
    _, path = export()
    staged = validate(path)
    assert staged.status == "ready", staged.message
    save([])
    with session_factory().begin() as db:
        db.get(GarmentSubtype, UUID(s["id"])).active = False
    workflow.process(confirm(staged))
    assert control.require(staged.restore_id).status == "succeeded"
    after = read()
    assert after["plan"] == before["plan"]
    assert after["counts"] == before["counts"]
    assert client.get("/api/v1/garment-subtypes").json()["data"][0]["active"] is True


def test_w1_upgrade_preserves_subtypes_and_does_not_seed_targets():
    spec = importlib.util.spec_from_file_location(
        "w2_migration", Path("migrations/versions/0008_inventory.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with get_engine().connect() as connection:
        tx = connection.begin()
        try:
            connection.execute(text("CREATE SCHEMA inventory_upgrade_probe"))
            connection.execute(text("SET LOCAL search_path TO inventory_upgrade_probe"))
            connection.execute(
                text(
                    "CREATE TABLE garment_subtypes (id uuid PRIMARY KEY, "
                    "category text NOT NULL, name text NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO garment_subtypes VALUES "
                    "('00000000-0000-4000-8000-000000000001','top','衬衫')"
                )
            )
            before = connection.execute(
                text("SELECT id, category, name FROM garment_subtypes")
            ).all()
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
            assert (
                connection.execute(text("SELECT id, category, name FROM garment_subtypes")).all()
                == before
            )
            assert connection.execute(
                text("SELECT active, version FROM garment_subtypes")
            ).one() == (True, 1)
            assert connection.scalar(text("SELECT count(*) FROM inventory_plans")) == 0
            assert connection.scalar(text("SELECT count(*) FROM inventory_demands")) == 0
        finally:
            tx.rollback()
