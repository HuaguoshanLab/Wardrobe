import importlib.util
from pathlib import Path
from uuid import UUID

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from test_backups import confirm, controls, export, validate  # noqa: F401
from test_outfits import client, headers, wardrobe  # noqa: F401
from test_travel import ROOT, create, generate, payload, read

from app.backup import control, database, workflow
from app.db.session import get_engine, session_factory
from app.db.travel import TravelPlan

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_archive_restores_versions_packing_tombstones_receipts_and_pending():
    plan, _ = generate(create())
    item = plan["packing"][0]
    plan = client.post(
        f"{ROOT}/{plan['id']}/packing",
        json={
            "expected_version": plan["version"],
            "garment_id": item["garment_id"],
            "packed": True,
        },
        headers=headers(),
    ).json()["data"]
    key = headers()
    deleted = create(key=key)
    client.request(
        "DELETE", f"{ROOT}/{deleted['id']}", json={"expected_version": 1}, headers=headers()
    )
    pending = client.post(
        f"{ROOT}/{plan['id']}/generate",
        json={"expected_version": plan["version"]},
        headers=headers(),
    ).json()["data"]
    plan = read(plan)
    _, path = export()
    ready = validate(path)
    # The backup controller already interrupted queued work before taking the snapshot.
    client.patch(
        f"{ROOT}/{plan['id']}",
        json={**payload(), "expected_version": plan["version"], "name": "changed"},
        headers=headers(),
    )
    epoch = database.data_epoch()
    workflow.process(confirm(ready))
    assert control.require(ready.restore_id).status == "succeeded"
    assert read(plan) == plan and database.data_epoch() != epoch
    assert create(key=key) == deleted
    assert client.get(f"{ROOT}/{deleted['id']}").status_code == 404
    assert client.get(f"/api/v1/jobs/{pending['job_id']}").json()["data"]["status"] == "interrupted"
    assert client.get(item["item"]["image_url"]).status_code == 200
    with session_factory()() as db:
        assert db.get(TravelPlan, UUID(deleted["id"])).deleted_at


def test_additive_travel_upgrade_and_guarded_downgrade():
    spec = importlib.util.spec_from_file_location(
        "travel_migration", Path("migrations/versions/0014_travel.py")
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
            connection.execute(text("CREATE SCHEMA travel_upgrade_probe"))
            connection.execute(text("SET LOCAL search_path TO travel_upgrade_probe, public"))
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
                assert connection.execute(text("SELECT count(*) FROM travel_plans")).scalar() == 0
                module.downgrade()
            assert (
                connection.execute(text("SELECT row_to_json(t) FROM public.garments t ORDER BY id"))
                .scalars()
                .all()
                == before
            )
        finally:
            transaction.rollback()
