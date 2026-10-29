"""Only the dedicated PostgreSQL test database is mutated/restored."""

from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

import pytest
from sqlalchemy import func, select
from test_backups import confirm, controls, export, validate  # noqa: F401
from test_outfits import headers, wardrobe  # noqa: F401
from test_seasonal import action, batch, create, finish, progress, read, reviewed

from app.backup import control, database, workflow
from app.db.lifecycle import LifecycleEvent
from app.db.seasonal import SeasonalSession
from app.db.session import session_factory

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_concurrent_same_batch_and_completion_have_single_effect():
    s = reviewed(create(categories=["top"]))
    payload = [action(i) for i in s["items"]]
    key = headers()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: batch(s, payload, key), range(2)))
    assert all(r.status_code == 200 for r in results)
    assert results[0].json()["data"] == results[1].json()["data"]
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(LifecycleEvent)) == 2
    s = read(s)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: finish(s), range(2)))
    assert sorted(r.status_code for r in results) == [200, 409]


def test_full_restore_preserves_active_progress_receipts_summary_and_media():
    active = reviewed(create(categories=["top"]))
    a = action(active["items"][0])
    b = action(active["items"][1], expected_version=999)
    key = headers()
    result = batch(active, [a, b], key).json()["data"]
    completed = reviewed(create(categories=["bottom"]))
    completed = finish(completed).json()["data"]
    before = read(active)
    _, path = export()
    staged = validate(path)
    assert staged.status == "ready", staged.message
    assert progress(before, stage="summary").status_code == 200
    with session_factory().begin() as db:
        db.get(SeasonalSession, UUID(completed["id"])).summary = None
    workflow.process(confirm(staged))
    assert control.require(staged.restore_id).status == "succeeded"
    after = read(active)
    assert after["items"] == before["items"]
    assert after["actions"] == before["actions"]
    assert after["stage"] == before["stage"]
    assert read(completed) == completed
    assert batch(active, [a, b], key).json()["data"] == result
    output = path.parent / "w4-roundtrip.json"
    database.export_data(output)
    data = database.load_data(output)
    assert all(
        data[f"public.{t}"] for t in ["seasonal_sessions", "seasonal_items", "seasonal_actions"]
    )
    assert database.media_keys(data)
