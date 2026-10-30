from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from test_outfits import client, generate, headers, session, wardrobe  # noqa: F401

from app.db.collections import WearRecord
from app.db.models import Job
from app.db.outfits import ModelCall, OutfitImage, OutfitRevision, OutfitSession
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.schemas.collections import today

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def payload(ids, mode="save"):
    return {
        "mode": mode,
        "items": [
            {
                "garment_id": str(gid),
                "expected_version": client.get(f"/api/v1/garments/{gid}").json()["data"]["version"],
            }
            for gid in ids
        ],
        **({"worn_on": str(today()), "notes": "自己选的"} if mode == "wear" else {}),
    }


def save(body, key=None):
    return client.post("/api/v1/manual-outfits", headers=key or headers(), json=body)


def counts():
    with session_factory()() as db:
        return {
            model.__tablename__: db.scalar(select(func.count()).select_from(model))
            for model in [Job, ModelCall, OutfitSession, OutfitRevision, OutfitImage, WearRecord]
        }


def test_manual_save_without_jobs_and_explicit_wear_reuse_edit(wardrobe):  # noqa: F811
    before = counts()
    body = payload(wardrobe[:3])
    key = headers()
    response = save(body, key)
    assert response.status_code == 201, response.text
    saved = response.json()["data"]
    r = saved["revision"]
    assert saved["wear"] is None and r["source"] == "manual"
    assert r["session_id"] is None and r["run_id"] is None and r["provider_mode"] is None
    assert save(body, key).json()["data"] == saved
    after = counts()
    for name in ["jobs", "outfit_model_calls", "outfit_sessions", "wear_records"]:
        assert after[name] == before[name]
    assert after["outfit_revisions"] == before["outfit_revisions"] + 1
    assert save({**body, "items": body["items"][:1]}, key).status_code == 409
    wear = client.post("/api/v1/wear-records", headers=headers(), json={"revision_id": r["id"]})
    assert wear.status_code == 201
    reused = client.post(
        "/api/v1/outfit-sessions", headers=headers(), json={"base_revision_id": r["id"]}
    )
    assert reused.status_code == 201, reused.text
    assert reused.json()["data"]["selected_revision_id"] == r["id"]
    assert counts()["jobs"] == before["jobs"]
    edited = save({**payload(wardrobe[1:3]), "parent_revision_id": r["id"]}).json()["data"]
    assert edited["revision"]["parent_revision_id"] == r["id"]
    assert edited["revision"]["id"] != r["id"]
    assert client.get(f"/api/v1/outfit-revisions/{r['id']}").json()["data"] == r


def test_direct_wear_is_atomic_idempotent_and_aggregates_both_sources(wardrobe):  # noqa: F811
    generated, _ = generate(session())
    ai = generated["revisions"][0]
    gid = UUID(ai["items"][0]["garment_id"])
    client.post("/api/v1/wear-records", headers=headers(), json={"revision_id": ai["id"]})
    body, key = payload([gid], "wear"), headers()
    before = counts()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: save(body, key), range(2)))
    assert [r.status_code for r in results] == [201, 201]
    result = results[0].json()["data"]
    assert result == results[1].json()["data"]
    assert result["wear"]["revision_id"] == result["revision"]["id"]
    assert counts()["wear_records"] == before["wear_records"] + 1
    summary = client.get(f"/api/v1/garments/{gid}/lifecycle").json()["data"]
    assert summary["wear_days"] == 1
    assert summary["last_worn_on"] == str(today())
    wear = result["wear"]
    path = f"/api/v1/wear-records/{wear['id']}"
    edited = client.patch(
        path,
        headers=headers(),
        json={"expected_version": 1, "worn_on": str(today() - timedelta(days=1)), "notes": "补记"},
    )
    assert edited.status_code == 200
    assert client.get(f"/api/v1/garments/{gid}/lifecycle").json()["data"]["wear_days"] == 2
    assert client.delete(path, headers=headers() | {"If-Match": "2"}).status_code == 200
    assert client.get(f"/api/v1/garments/{gid}/lifecycle").json()["data"]["wear_days"] == 1
    assert counts()["jobs"] == before["jobs"]


def test_unavailable_requires_exact_confirmation_and_does_not_change_state(wardrobe):  # noqa: F811
    gid = wardrobe[0]
    with session_factory().begin() as db:
        g = db.get(Garment, gid)
        g.attributes = {**g.attributes, "availability": "unavailable"}
        g.lifecycle = {"unavailable_reason": "washing"}
    assert save(payload([gid])).status_code == 409
    body = payload([gid], "wear")
    assert save(body).status_code == 409
    assert save({**body, "acknowledged_unavailable_ids": [str(wardrobe[1])]}).status_code == 409
    before = client.get(f"/api/v1/garments/{gid}").json()["data"]
    assert save({**body, "acknowledged_unavailable_ids": [str(gid)]}).status_code == 201
    assert client.get(f"/api/v1/garments/{gid}").json()["data"] == before


@pytest.mark.parametrize("kind", ["deleted", "retired", "demo", "version", "missing"])
def test_invalid_or_changed_items_leave_no_partial_snapshot(wardrobe, kind):  # noqa: F811
    body = payload(wardrobe[:2], "wear")
    with session_factory().begin() as db:
        g = db.get(Garment, wardrobe[1])
        if kind == "deleted":
            from app.db.models import utcnow

            g.deleted_at = utcnow()
        elif kind == "retired":
            g.ownership = "retired"
        elif kind == "demo":
            g.is_demo = True
        elif kind == "version":
            g.version += 1
        else:
            body["items"][1]["garment_id"] = str(uuid4())
    before = counts()
    assert save(body).status_code == 409
    assert counts() == before


def test_schema_boundaries_and_rollback_after_snapshot_creation(wardrobe, monkeypatch):  # noqa: F811
    body = payload(wardrobe[:2], "wear")
    bad = [
        {**body, "items": []},
        {**body, "items": body["items"] * 11},
        {**body, "items": [body["items"][0]] * 2},
        {**body, "worn_on": str(today() + timedelta(days=1))},
        {**body, "worn_on": None},
        {**body, "mode": "save"},
    ]
    for value in bad:
        assert save(value).status_code == 422
    from app.services.outfits import manual

    original = manual.snapshot
    calls = 0

    def fail_second(*args):
        nonlocal calls
        calls += 1
        if calls == 2:
            from app.core.errors import AppError

            raise AppError("CONSTRAINT_CONFLICT", "test missing image")
        return original(*args)

    monkeypatch.setattr(manual, "snapshot", fail_second)
    before = counts()
    assert save(body).status_code == 409
    assert counts() == before


def test_manual_snapshots_images_and_references_survive_garment_deletion(wardrobe):  # noqa: F811
    result = save(payload(wardrobe[:2], "wear")).json()["data"]
    r = result["revision"]
    image = r["items"][0]["image_url"]
    pixels = client.get(image).content
    fav = client.post("/api/v1/favorites", headers=headers(), json={"revision_id": r["id"]})
    assert fav.status_code == 201
    gid = wardrobe[0]
    assert client.delete(f"/api/v1/garments/{gid}", headers={"If-Match": "1"}).status_code == 204
    assert client.get(image).content == pixels
    assert client.get(f"/api/v1/outfit-revisions/{r['id']}").json()["data"] == r
    assert (
        client.delete(
            f"/api/v1/outfit-revisions/{r['id']}", headers=headers() | {"If-Match": "1"}
        ).status_code
        == 200
    )
    assert client.get("/api/v1/favorites").json()["data"]["items"][0]["revision"] == r
    assert client.get("/api/v1/wear-records").json()["data"]["items"][0] == result["wear"]
