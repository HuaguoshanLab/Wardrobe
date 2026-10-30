from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from test_manual_outfits import payload, save
from test_outfits import client, generate, headers, session, wardrobe  # noqa: F401

from app.db.feedback import WearFeedback
from app.db.models import Job
from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.db.wardrobe import Garment

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def record(ids):
    response = save(payload(ids, "wear"))
    assert response.status_code == 201, response.text
    return response.json()["data"]["wear"]


def path(wear):
    return f"/api/v1/wear-records/{wear['id']}/feedback"


def body(version=0, **feedback):
    return {"expected_version": version, "feedback": {"thermal": "hot", **feedback}}


def test_save_replay_conflict_target_and_snapshot(wardrobe):  # noqa: F811
    wear = record(wardrobe[:2])
    original = client.get(f"/api/v1/outfit-revisions/{wear['revision_id']}").json()["data"]
    prefs = client.get("/api/v1/profile/preferences").json()["data"]
    assert client.get(path(wear)).json()["data"]["version"] == 0
    assert client.get(f"/api/v1/wear-records/{wear['id']}").json()["data"] == wear
    key = headers()
    data = body(garment_id=str(wardrobe[0]), notes="  腋下不舒适  ")
    first = client.patch(path(wear), headers=key, json=data)
    assert first.status_code == 200, first.text
    saved = first.json()["data"]
    assert saved["feedback"]["notes"] == "腋下不舒适"
    assert client.patch(path(wear), headers=key, json=data).json()["data"] == saved
    assert client.patch(path(wear), headers=key, json=body()).status_code == 409
    assert client.patch(path(wear), headers=headers(), json=body()).status_code == 409
    assert (
        client.patch(
            path(wear), headers=headers(), json=body(1, garment_id=str(wardrobe[3]))
        ).status_code
        == 422
    )
    assert (
        client.patch(
            path(wear), headers=headers(), json={"expected_version": 1, "feedback": {}}
        ).status_code
        == 422
    )
    assert client.get("/api/v1/profile/preferences").json()["data"] == prefs
    assert client.get(f"/api/v1/outfit-revisions/{wear['revision_id']}").json()["data"] == original
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(Job)) == 0
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0


def test_deleted_garment_is_still_valid_snapshot_target(wardrobe):  # noqa: F811
    wear = record(wardrobe[:1])
    with session_factory().begin() as db:
        from app.db.models import utcnow

        db.get(Garment, wardrobe[0]).deleted_at = utcnow()
    assert (
        client.patch(
            path(wear), headers=headers(), json=body(garment_id=str(wardrobe[0]))
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/v1/wear-records/{uuid4()}/feedback", headers=headers(), json=body()
        ).status_code
        == 404
    )


def test_concurrent_create_and_tombstone_prevent_stale_resurrection(wardrobe):  # noqa: F811
    wear = record(wardrobe[:1])
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda _: client.patch(path(wear), headers=headers(), json=body()), range(2))
        )
    assert sorted(r.status_code for r in responses) == [200, 409]
    key = {**headers(), "If-Match": "1"}
    deleted = client.delete(path(wear), headers=key).json()["data"]
    assert deleted["feedback"] is None and deleted["version"] == 2
    assert client.delete(path(wear), headers=key).json()["data"] == deleted
    assert client.patch(path(wear), headers=headers(), json=body()).status_code == 409
    assert (
        client.patch(path(wear), headers=headers(), json=body(2, thermal="cold")).json()["data"][
            "version"
        ]
        == 3
    )


def test_generated_feedback_and_explicit_preferences_next_context(wardrobe):  # noqa: F811
    state, _ = generate(session())
    revision = state["revisions"][0]
    wear = client.post(
        "/api/v1/wear-records", headers=headers(), json={"revision_id": revision["id"]}
    ).json()["data"]
    assert client.patch(path(wear), headers=headers(), json=body()).status_code == 200
    before = client.get("/api/v1/profile/preferences").json()["data"]
    preference = {
        "expected_version": before["version"],
        "preferences": {"notes": "参考上次偏热感受，下次透气些"},
    }
    key = headers()
    result = client.patch("/api/v1/profile/preferences", headers=key, json=preference)
    assert result.status_code == 200
    assert (
        client.patch("/api/v1/profile/preferences", headers=key, json=preference).json()["data"]
        == result.json()["data"]
    )
    state2 = session()
    changed = client.patch(
        f"/api/v1/outfit-sessions/{state2['id']}",
        headers=headers(),
        json={
            "expected_version": state2["version"],
            "requirements": {
                "notes": "本次请保暖",
                "weather_override": {"temperature_c": 0, "condition": "雪"},
            },
        },
    )
    assert changed.status_code == 200, changed.text
    generated, _ = generate(changed.json()["data"])
    snapshot = generated["revisions"][0]["request_snapshot"]
    assert snapshot["preferences"]["notes"] == preference["preferences"]["notes"]
    assert snapshot["requirements"]["notes"] == "本次请保暖"
    assert client.get(f"/api/v1/outfit-revisions/{revision['id']}").json()["data"] == revision
    client.delete(path(wear), headers={**headers(), "If-Match": "1"})
    assert client.get("/api/v1/profile/preferences").json()["data"] == result.json()["data"]


def test_wear_delete_cascades_but_preferences_and_revision_remain(wardrobe):  # noqa: F811
    wear = record(wardrobe[:1])
    client.patch(path(wear), headers=headers(), json=body())
    prefs = client.get("/api/v1/profile/preferences").json()["data"]
    assert (
        client.delete(
            f"/api/v1/wear-records/{wear['id']}",
            headers={**headers(), "If-Match": str(wear["version"])},
        ).status_code
        == 200
    )
    assert client.get(path(wear)).status_code == 404
    with session_factory()() as db:
        assert db.get(WearFeedback, UUID(wear["id"])) is None
    assert client.get(f"/api/v1/outfit-revisions/{wear['revision_id']}").status_code == 200
    assert client.get("/api/v1/profile/preferences").json()["data"] == prefs
