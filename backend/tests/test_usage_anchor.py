from uuid import uuid4

import pytest
from sqlalchemy import func, select
from test_outfits import client, generate, headers
from test_outfits import wardrobe as wardrobe

from app.db.models import Job, utcnow
from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.db.wardrobe import Garment

pytestmark = pytest.mark.integration


def test_anchor_create_is_idempotent_no_generation_and_explicit_generation_keeps_item(wardrobe):
    key = headers()
    body = {
        "anchor_garment_id": str(wardrobe[1]),
        "requirements": {"weather_override": {"temperature_c": 20, "condition": "晴"}},
    }
    path = "/api/v1/outfit-sessions"
    response = client.post(path, headers=key, json=body)
    assert response.status_code == 201, response.text
    s = response.json()["data"]
    assert s["selected_revision_id"] is None and s["locked_garment_ids"] == [str(wardrobe[1])]
    assert client.post(path, headers=key, json=body).json()["data"] == s
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0
        assert db.scalar(select(func.count()).select_from(Job)) == 0
    saved, job = generate(s)
    assert saved["revisions"]
    assert all(
        str(wardrobe[1]) in [i["garment_id"] for i in r["items"]] for r in saved["revisions"]
    )


@pytest.mark.parametrize("state", ["unavailable", "retired", "deleted", "demo", "missing"])
def test_anchor_rejects_unusable_current_garment(wardrobe, state):
    gid = wardrobe[0]
    with session_factory().begin() as db:
        g = db.get(Garment, gid)
        if state == "unavailable":
            g.attributes = {**g.attributes, "availability": "unavailable"}
        if state == "retired":
            g.ownership = "retired"
        if state == "deleted":
            g.deleted_at = utcnow()
        if state == "demo":
            g.is_demo = True
        if state == "missing":
            gid = uuid4()
    response = client.post(
        "/api/v1/outfit-sessions", headers=headers(), json={"anchor_garment_id": str(gid)}
    )
    assert response.status_code == 409


def test_anchor_conflict_after_creation_keeps_lock_and_allows_explicit_removal(wardrobe):
    gid = wardrobe[0]
    s = client.post(
        "/api/v1/outfit-sessions", headers=headers(), json={"anchor_garment_id": str(gid)}
    ).json()["data"]
    path = f"/api/v1/outfit-sessions/{s['id']}"
    with session_factory().begin() as db:
        g = db.get(Garment, gid)
        g.attributes = {**g.attributes, "availability": "unavailable"}
    response = client.post(
        path + "/generate", headers=headers(), json={"expected_version": s["version"]}
    )
    assert response.status_code == 409
    assert client.get(path).json()["data"]["locked_garment_ids"] == [str(gid)]
    response = client.patch(
        path, headers=headers(), json={"expected_version": s["version"], "locked_garment_ids": []}
    )
    assert response.status_code == 200
    assert response.json()["data"]["locked_garment_ids"] == []
    assert (
        client.post(
            "/api/v1/outfit-sessions",
            headers=headers(),
            json={"anchor_garment_id": str(gid), "base_revision_id": str(uuid4())},
        ).status_code
        == 422
    )


def test_pre_upgrade_create_receipt_replays_without_new_anchor_field(wardrobe):
    import hashlib
    import json

    from app.db.wardrobe import OperationReceipt
    from app.schemas.profile import Requirements

    key = headers()
    first = client.post("/api/v1/outfit-sessions", headers=key, json={})
    old_payload = {"requirements": Requirements().model_dump(mode="json"), "base_revision_id": None}
    legacy_hash = hashlib.sha256(
        json.dumps(old_payload, sort_keys=True, default=str).encode()
    ).hexdigest()
    with session_factory().begin() as db:
        receipt = db.scalar(
            select(OperationReceipt).where(OperationReceipt.key == key["Idempotency-Key"])
        )
        assert receipt.request_hash == legacy_hash
        receipt.request_hash = legacy_hash
    repeated = client.post("/api/v1/outfit-sessions", headers=key, json={})
    assert repeated.status_code == 201
    assert repeated.json()["data"] == first.json()["data"]
