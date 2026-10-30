from datetime import timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select
from test_backups import confirm, controls, export, validate  # noqa: F401
from test_outfits import client, current, generate, headers, session
from test_outfits import wardrobe as wardrobe

from app.backup import control, workflow
from app.db.collections import WearRecord
from app.db.models import Job, utcnow
from app.db.outfits import ModelCall, OutfitRevision
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.jobs.queue import claim
from app.jobs.worker import run_job
from app.services.outfits.rotation import rotation_snapshot
from app.services.outfits.snapshots import snapshot

pytestmark = pytest.mark.integration


def today():
    return utcnow().astimezone(ZoneInfo("Asia/Shanghai")).date()


def record(ids, offset=0):
    # Independent revisions deliberately share combinations and dates.
    with session_factory().begin() as db:
        revision = OutfitRevision(
            id=uuid4(),
            source="manual",
            position=0,
            items=[snapshot(db, db.get(Garment, gid), {}).model_dump(mode="json") for gid in ids],
            reason="实际记录",
            unmet_requirements=[],
            weather_snapshot={},
            request_snapshot={},
        )
        db.add(revision)
        db.flush()
        wear = WearRecord(
            id=uuid4(), revision_id=revision.id, worn_on=today() - timedelta(days=offset)
        )
        db.add(wear)
        return wear.id


def with_mode(s, mode):
    response = client.patch(
        f"/api/v1/outfit-sessions/{s['id']}",
        headers=headers(),
        json={
            "expected_version": s["version"],
            "requirements": {**s["requirements"], "rotation_mode": mode},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_all_records_windows_dedup_and_deleted_garment_history(wardrobe):
    ids = [wardrobe[0], wardrobe[2], wardrobe[4]]
    for _ in range(105):
        record(ids)
    record(list(reversed(ids)), 6)
    record(ids, 7)
    record(ids, 29)
    record(ids, 30)
    with session_factory().begin() as db:
        db.get(Garment, ids[0]).deleted_at = utcnow()
    with session_factory()() as db:
        stats = rotation_snapshot(db, today())
    assert stats.records_7 == 106 and stats.records_30 == 108
    assert stats.days_7 == 2 and stats.days_30 == 4
    assert stats.garment_days[str(ids[0])] == 4
    assert len(stats.combinations) == 1
    assert set(stats.combinations[0].body_ids) == set(map(str, ids[:2]))
    s, _ = generate(with_mode(session(), "avoid_recent"))
    assert all(str(ids[0]) != i["garment_id"] for r in s["revisions"] for i in r["items"])


def test_submission_freezes_records_replay_and_next_generation_reads_edits(wardrobe):
    wid = record([wardrobe[0], wardrobe[2], wardrobe[4]])
    s = with_mode(session(), "less_worn")
    path = f"/api/v1/outfit-sessions/{s['id']}/generate"
    key = headers()
    body = {"expected_version": s["version"]}
    accepted = client.post(path, headers=key, json=body).json()["data"]
    with session_factory().begin() as db:
        db.get(WearRecord, wid).worn_on = today() - timedelta(days=35)
    # Same submission retains stats even after record modification.
    assert client.post(path, headers=key, json=body).json()["data"] == accepted
    claimed = claim()
    run_job(*claimed)
    s = current()
    old = s["revisions"][0]
    assert old["request_snapshot"]["rotation"]["record_count"] == 1
    with session_factory()() as db:
        job = db.get(Job, UUID(accepted["job_id"]))
        assert job.input_snapshot["rotation"] == job.input_snapshot["context"]["rotation"]
        before = db.scalar(select(func.count()).select_from(ModelCall))
    run_job(*claimed)
    client.get("/api/v1/outfit-sessions/current")
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == before
    s, _ = generate(s)
    assert s["revisions"][0]["request_snapshot"]["rotation"]["record_count"] == 0
    with session_factory().begin() as db:
        db.delete(db.get(WearRecord, wid))
    record([wardrobe[1], wardrobe[3]], 2)
    s, _ = generate(s)
    assert s["revisions"][0]["request_snapshot"]["rotation"]["record_count"] == 1
    assert client.get("/api/v1/outfit-revisions/" + old["id"]).json()["data"] == old


def test_preview_reuse_and_backup_restore_saved_rotation(wardrobe, controls):  # noqa: F811
    record([wardrobe[0], wardrobe[2]])
    preview = client.post("/api/v1/conditions/preview", json={"rotation_mode": "avoid_recent"})
    assert preview.status_code == 200
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0
    s, job = generate(with_mode(session(), "avoid_recent"))
    revision = s["revisions"][0]
    reused = client.post(
        "/api/v1/outfit-sessions", headers=headers(), json={"base_revision_id": revision["id"]}
    ).json()["data"]
    assert reused["requirements"]["rotation_mode"] == "avoid_recent"
    _, path = export()
    ready = validate(path)
    assert ready.status == "ready", ready.message
    with session_factory().begin() as db:
        db.get(OutfitRevision, UUID(revision["id"])).request_snapshot = {}
    workflow.process(confirm(ready))
    assert control.require(ready.restore_id).status == "succeeded"
    assert client.get("/api/v1/outfit-revisions/" + revision["id"]).json()["data"] == revision
    with session_factory()() as db:
        restored = db.get(Job, UUID(job["id"]))
        assert restored.input_snapshot["context"]["rotation"]["records_7"] == 1


def test_generated_and_manual_same_day_share_actual_wear_count(wardrobe):
    saved, _ = generate(session())
    revision = saved["revisions"][0]
    ids = [UUID(i["garment_id"]) for i in revision["items"] if i["source"] == "wardrobe"]
    record(ids)
    with session_factory().begin() as db:
        db.add(WearRecord(revision_id=UUID(revision["id"]), worn_on=today()))
    with session_factory()() as db:
        stats = rotation_snapshot(db, today())
        assert stats.records_30 == 2 and stats.days_30 == 1
        assert all(stats.garment_days[str(gid)] == 1 for gid in ids)
        assert len(stats.combinations) == 1


def test_provider_receives_explicit_keep_and_exclude_ids(wardrobe):
    from unittest.mock import patch

    from app.schemas.outfits import Intent, OutfitContext
    from app.services.outfits.calls import model_call
    from app.services.outfits.context import prepare_context

    s, _ = generate(session())
    base = s["revisions"][0]
    target = next(i for i in base["items"] if i["source"] == "wardrobe")
    response = client.post(
        f"/api/v1/outfit-sessions/{s['id']}/generate",
        headers=headers(),
        json={"expected_version": s["version"]},
    )
    assert response.status_code == 202
    job_id, token = claim()
    context = OutfitContext.model_validate(prepare_context(job_id, token))
    intent = Intent(scope="replace_items", target_item_ids=[UUID(target["item_id"])])
    with session_factory().begin() as db:
        job = db.get(Job, job_id)
        job.input_snapshot = {**job.input_snapshot, "provider_mode": "qwen"}
    with patch("app.providers.qwen.invoke", return_value={"outfits": []}) as invoke:
        model_call(job_id, token, "outfits", 0, context, intent)
    constraints = invoke.call_args.args[0]["hard_constraints"]
    assert constraints["excluded_from_every_outfit"] == [target["garment_id"]]
    assert set(constraints["required_in_every_outfit"]) == {
        i["garment_id"]
        for i in base["items"]
        if i["source"] == "wardrobe" and i["item_id"] != target["item_id"]
    }
