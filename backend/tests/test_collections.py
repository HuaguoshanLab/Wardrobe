from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import select
from test_outfits import client, current, generate, headers, session, wardrobe  # noqa: F401

from app.db.models import Job
from app.db.outfits import OutfitRevision
from app.db.session import session_factory
from app.schemas.collections import today

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_hide_keeps_favorite_wear_snapshot_and_clears_reused_sessions():
    s, _ = generate(session())
    revision = s["revisions"][0]
    rid = revision["id"]
    image = next(i["image_url"] for i in revision["items"] if i["image_url"])
    image_bytes = client.get(image).content
    favorite = client.post(
        "/api/v1/favorites", headers=headers(), json={"revision_id": rid, "name": "雪天"}
    ).json()["data"]
    assert client.get("/api/v1/wear-records").json()["data"]["items"] == []
    wear = client.post("/api/v1/wear-records", headers=headers(), json={"revision_id": rid}).json()[
        "data"
    ]
    reused = client.post(
        "/api/v1/outfit-sessions", headers=headers(), json={"base_revision_id": rid}
    ).json()["data"]
    key = headers() | {"If-Match": "1"}
    response = client.delete(f"/api/v1/outfit-revisions/{rid}", headers=key)
    assert response.status_code == 200, response.text
    assert (
        client.delete(f"/api/v1/outfit-revisions/{rid}", headers=key).json()["data"]
        == response.json()["data"]
    )
    for sid in [s["id"], reused["id"]]:
        saved = client.get(f"/api/v1/outfit-sessions/{sid}").json()["data"]
        assert saved["selected_revision_id"] is None
        assert rid not in saved["latest_revision_ids"]
        assert saved["locked_garment_ids"] == []
    assert rid not in [
        i["revision"]["id"] for i in client.get("/api/v1/outfit-revisions").json()["data"]["items"]
    ]
    assert client.get("/api/v1/favorites").json()["data"]["items"][0] == favorite
    assert client.get("/api/v1/wear-records").json()["data"]["items"][0] == wear
    assert client.get(f"/api/v1/outfit-revisions/{rid}").json()["data"] == revision
    assert client.get(image).content == image_bytes


def test_wear_dates_dedup_versions_and_favorite_name():
    s, _ = generate(session())
    rid = s["selected_revision_id"]
    snapshot = client.get(f"/api/v1/outfit-revisions/{rid}").json()["data"]
    key = headers()
    body = {"revision_id": rid, "worn_on": str(today() - timedelta(days=1)), "notes": "昨天"}
    first = client.post("/api/v1/wear-records", headers=key, json=body).json()["data"]
    assert client.post("/api/v1/wear-records", headers=key, json=body).json()["data"] == first
    assert client.post("/api/v1/wear-records", headers=headers(), json=body).json()["data"] == first
    assert (
        client.post(
            "/api/v1/wear-records",
            headers=headers(),
            json={"revision_id": rid, "worn_on": str(today() + timedelta(days=1))},
        ).status_code
        == 422
    )
    path = f"/api/v1/wear-records/{first['id']}"
    edited = client.patch(
        path,
        headers=headers(),
        json={"expected_version": 1, "worn_on": str(today()), "notes": "今天"},
    )
    assert edited.status_code == 200, edited.text
    assert client.delete(path, headers=headers() | {"If-Match": "1"}).status_code == 409
    assert client.delete(path, headers=headers() | {"If-Match": "2"}).status_code == 200
    favorite = client.post(
        "/api/v1/favorites", headers=headers(), json={"revision_id": rid}
    ).json()["data"]
    assert (
        client.post("/api/v1/favorites", headers=headers(), json={"revision_id": rid}).json()[
            "data"
        ]
        == favorite
    )
    path = f"/api/v1/favorites/{favorite['id']}"
    assert (
        client.patch(path, headers=headers(), json={"expected_version": 1, "name": "命名"}).json()[
            "data"
        ]["name"]
        == "命名"
    )
    assert client.delete(path, headers=headers() | {"If-Match": "2"}).status_code == 200
    assert client.get(f"/api/v1/outfit-revisions/{rid}").json()["data"] == snapshot


def test_history_busy_and_pagination():
    s, _ = generate(session())
    page = client.get("/api/v1/outfit-revisions?limit=1").json()["data"]
    second = client.get(f"/api/v1/outfit-revisions?limit=1&cursor={page['next_cursor']}").json()[
        "data"
    ]
    assert second["items"][0]["revision"]["id"] != page["items"][0]["revision"]["id"]
    submitted = client.post(
        f"/api/v1/outfit-sessions/{s['id']}/generate",
        headers=headers(),
        json={"expected_version": s["version"]},
    )
    assert submitted.status_code == 202
    assert (
        client.delete(
            f"/api/v1/outfit-revisions/{s['selected_revision_id']}",
            headers=headers() | {"If-Match": "1"},
        ).status_code
        == 409
    )
    assert current()["selected_revision_id"] == s["selected_revision_id"]
    with session_factory()() as db:
        assert (
            db.get(OutfitRevision, UUID(s["selected_revision_id"])).hidden_from_history_at is None
        )
        assert len(list(db.scalars(select(Job)))) == 2
