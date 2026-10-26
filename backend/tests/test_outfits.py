from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import BytesIO
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select

from app.agent.checkpoints import checkpointer
from app.agent.outfits import build_outfit_graph
from app.db.models import Job, utcnow
from app.db.outfits import ModelCall, OutfitRevision
from app.db.session import session_factory
from app.db.wardrobe import Garment, MediaAsset
from app.jobs.queue import claim, sweep
from app.jobs.worker import run_job
from app.main import app
from app.media.storage import store_bytes
from app.schemas.wardrobe import Attributes
from app.services.operations import owner_id

pytestmark = pytest.mark.integration
client = TestClient(app)


def headers():
    return {"Idempotency-Key": str(uuid4())}


@pytest.fixture
def wardrobe(clean_db):
    image = BytesIO()
    Image.new("RGB", (16, 16), "blue").save(image, format="PNG")
    key, digest = store_bytes(image.getvalue())
    ids = []
    with session_factory().begin() as db:
        owner = owner_id(db)
        media = MediaAsset(
            id=uuid4(),
            owner_id=owner,
            original_key=key,
            original_name="test.png",
            sha256=digest,
            display_key=key,
            width=16,
            height=16,
        )
        db.add(media)
        db.flush()
        for category in ["top", "top", "bottom", "bottom", "shoes", "outerwear"]:
            garment = Garment(
                id=uuid4(),
                owner_id=owner,
                image_asset_id=media.id,
                attributes=Attributes(category=category, name=category).model_dump(mode="json"),
            )
            db.add(garment)
            ids.append(garment.id)
    return ids


def session():
    response = client.post(
        "/api/v1/outfit-sessions",
        headers=headers(),
        json={"requirements": {"weather_override": {"temperature_c": 0, "condition": "雪"}}},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def current():
    return client.get("/api/v1/outfit-sessions/current").json()["data"]


def generate(s):
    response = client.post(
        f"/api/v1/outfit-sessions/{s['id']}/generate",
        headers=headers(),
        json={"expected_version": s["version"]},
    )
    assert response.status_code == 202, response.text
    item = claim()
    assert item
    run_job(*item)
    job = client.get("/api/v1/jobs/" + response.json()["data"]["job_id"]).json()["data"]
    assert job["status"] == "succeeded", job
    return current(), job


def test_generate_snapshots_and_idempotent_submission(wardrobe):
    assert current() is None
    s = session()
    key = headers()
    path = f"/api/v1/outfit-sessions/{s['id']}/generate"
    first = client.post(path, headers=key, json={"expected_version": s["version"]})
    again = client.post(path, headers=key, json={"expected_version": s["version"]})
    assert first.status_code == 202 and first.json()["data"] == again.json()["data"]
    assert (
        client.post(path, headers=headers(), json={"expected_version": s["version"]}).status_code
        == 409
    )
    run_job(*claim())
    saved = current()
    assert 1 <= len(saved["revisions"]) <= 3
    combos = [
        frozenset(i["garment_id"] for i in r["items"] if i["source"] == "wardrobe")
        for r in saved["revisions"]
    ]
    assert len(set(combos)) == len(combos)
    old = saved["revisions"][0]
    assert old["weather_snapshot"]["temperature_c"] == 0
    assert old["provider_mode"] == "fake"
    image = next(i for i in old["items"] if i["image_url"])
    before = client.get(image["image_url"]).content
    with session_factory().begin() as db:
        garment = db.get(Garment, UUID(image["garment_id"]))
        garment.deleted_at = utcnow()
        garment.attributes = {**garment.attributes, "name": "changed"}
    after = client.get("/api/v1/outfit-revisions/" + old["id"]).json()["data"]
    assert old == after
    assert client.get(image["image_url"]).content == before
    assert len(current()["messages"]) == 2
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 1


def test_replace_preserves_every_non_target_and_lock_conflicts(wardrobe):
    s, _ = generate(session())
    base = s["revisions"][0]
    target = next(i for i in base["items"] if i["slot"] == "bottom")
    keep = [i for i in base["items"] if i["item_id"] != target["item_id"]]
    response = client.post(
        f"/api/v1/outfit-sessions/{s['id']}/adjust",
        headers=headers(),
        json={
            "expected_version": s["version"],
            "base_revision_id": base["id"],
            "scope": "replace_items",
            "target_item_ids": [target["item_id"]],
        },
    )
    assert response.status_code == 202, response.text
    run_job(*claim())
    s = current()
    updated = next(r for r in s["revisions"] if r["id"] == s["selected_revision_id"])
    assert updated["parent_revision_id"] == base["id"]
    assert all(i in updated["items"] for i in keep)
    assert target["garment_id"] not in [i["garment_id"] for i in updated["items"]]
    lock = next(i for i in updated["items"] if i["slot"] == "outerwear")
    s = client.patch(
        f"/api/v1/outfit-sessions/{s['id']}",
        headers=headers(),
        json={"expected_version": s["version"], "locked_garment_ids": [lock["garment_id"]]},
    ).json()["data"]
    with session_factory().begin() as db:
        garment = db.get(Garment, UUID(lock["garment_id"]))
        garment.attributes = {**garment.attributes, "availability": "unavailable"}
    response = client.post(
        f"/api/v1/outfit-sessions/{s['id']}/generate",
        headers=headers(),
        json={"expected_version": s["version"]},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CONSTRAINT_CONFLICT"
    assert current()["locked_garment_ids"] == [lock["garment_id"]]


def test_chat_clarification_and_specific_replacement(wardrobe):
    s, _ = generate(session())
    base = s["selected_revision_id"]
    for message in ["换一下那个", "只换裤子"]:
        response = client.post(
            f"/api/v1/outfit-sessions/{s['id']}/adjust",
            headers=headers(),
            json={
                "expected_version": s["version"],
                "base_revision_id": s["selected_revision_id"],
                "scope": "chat",
                "message": message,
            },
        )
        assert response.status_code == 202
        run_job(*claim())
        s = current()
        job = client.get("/api/v1/jobs/" + s["current_job_id"]).json()["data"]
        assert job["status"] == "succeeded", job
        if message == "换一下那个":
            assert job["result"]["outcome"] == "needs_clarification"
            assert s["selected_revision_id"] == base
        else:
            assert s["selected_revision_id"] != base


def test_empty_wardrobe_and_disabled_provider(clean_db):
    s, job = generate(session())
    assert job["result"]["outcome"] == "no_match"
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0
    from app.core.config import Settings

    with patch(
        "app.services.outfits.submit.get_settings", return_value=Settings(provider_mode="disabled")
    ):
        response = client.post(
            f"/api/v1/outfit-sessions/{s['id']}/generate",
            headers=headers(),
            json={"expected_version": s["version"]},
        )
        assert response.status_code == 503


def test_checkpoint_resume_reuses_saved_call_and_committed_result(wardrobe):
    s = session()
    client.post(
        f"/api/v1/outfit-sessions/{s['id']}/generate",
        headers=headers(),
        json={"expected_version": s["version"]},
    )
    job_id, token = claim()
    config = {"configurable": {"thread_id": "outfit:" + s["id"]}, "recursion_limit": 12}
    with checkpointer() as saver:
        graph = build_outfit_graph(saver, pause=True)
        graph.invoke({"job_id": str(job_id), "lease_token": str(token)}, config)
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(OutfitRevision)) == 0
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 1
    with checkpointer() as saver:
        graph = build_outfit_graph(saver)
        graph.invoke(None, config)
        graph.invoke({"job_id": str(job_id), "lease_token": str(token)}, config)
    with session_factory()() as db:
        assert db.get(Job, job_id).status == "succeeded"
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 1
        assert db.scalar(select(func.count()).select_from(OutfitRevision)) <= 3


def test_cancel_before_commit_and_worker_interruption(wardrobe):
    s = session()
    client.post(
        f"/api/v1/outfit-sessions/{s['id']}/generate",
        headers=headers(),
        json={"expected_version": s["version"]},
    )
    job_id, token = claim()
    config = {"configurable": {"thread_id": "outfit:" + s["id"]}}
    with checkpointer() as saver:
        build_outfit_graph(saver, pause=True).invoke(
            {"job_id": str(job_id), "lease_token": str(token)}, config
        )
    client.post(f"/api/v1/jobs/{job_id}/cancel")
    run_job(job_id, token)
    assert client.get(f"/api/v1/jobs/{job_id}").json()["data"]["status"] == "cancelled"
    assert current()["revisions"] == []
    s = current()
    client.post(
        f"/api/v1/outfit-sessions/{s['id']}/generate",
        headers=headers(),
        json={"expected_version": s["version"]},
    )
    job_id, token = claim()
    with session_factory().begin() as db:
        db.get(Job, job_id).heartbeat_at = utcnow() - timedelta(minutes=10)
    sweep()
    run_job(job_id, token)
    assert client.get(f"/api/v1/jobs/{job_id}").json()["data"]["status"] == "interrupted"
    assert current()["revisions"] == []


def test_concurrent_generations_only_one_active(wardrobe):
    s = session()

    def send(_):
        with TestClient(app) as api:
            return api.post(
                f"/api/v1/outfit-sessions/{s['id']}/generate",
                headers=headers(),
                json={"expected_version": s["version"]},
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(send, range(2))) == [202, 409]
