"""Cross-entry decisions must not leave stale W1 pending/keep state behind."""

import pytest
from test_organization import board, decide
from test_outfits import client, wardrobe  # noqa: F401

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


@pytest.mark.parametrize("state", ["observe", "undecided"])
def test_revoke_last_pending_clears_lifecycle_decision(wardrobe, state):  # noqa: F811
    gid = str(wardrobe[0])
    candidate = {
        "garment_id": gid,
        "garment_version": 1,
        "decision_version": 0,
        "reason_key": "manual",
    }
    assert decide(candidate, "pending").status_code == 200
    pending = next(c for c in board("pending")["candidates"] if c["garment_id"] == gid)
    response = decide(pending, state)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["lifecycle"]["decision"] == "undecided"
    assert response.json()["data"]["lifecycle"]["decision_reason"] == ""
    assert board("pending")["candidates"] == []


def test_revoke_one_reason_preserves_other_decisions_and_replays_once(wardrobe):  # noqa: F811
    from uuid import UUID

    from sqlalchemy import select
    from test_outfits import headers

    from app.db.lifecycle import LifecycleEvent
    from app.db.session import session_factory
    from app.db.wardrobe import Garment

    gid = str(wardrobe[0])
    with session_factory().begin() as db:
        g = db.get(Garment, UUID(gid))
        g.lifecycle = {"condition": "damaged", "fit": "unfit"}

    def candidate(reason):
        return next(
            c
            for c in board("all")["candidates"]
            if c["garment_id"] == gid and c["reason_key"] == reason
        )

    assert decide(candidate("condition:damaged"), "keep").status_code == 200
    assert decide(candidate("fit:unfit"), "pending").status_code == 200
    pending = candidate("fit:unfit")
    key = headers()
    result = decide(pending, "observe", key)
    assert result.status_code == 200
    assert result.json()["data"]["lifecycle"]["decision"] == "keep"
    assert result.json()["data"]["lifecycle"]["decision_reason"] == "我仍然需要这件"
    assert decide(pending, "observe", key).json()["data"] == result.json()["data"]
    assert candidate("condition:damaged")["state"] == "keep"
    assert decide(candidate("fit:unfit"), "pending").status_code == 200
    assert decide(candidate("condition:damaged"), "undecided").status_code == 200
    assert (
        client.get(f"/api/v1/garments/{gid}").json()["data"]["lifecycle"]["decision"] == "pending"
    )
    assert candidate("fit:unfit")["state"] == "pending"
    with session_factory()() as db:
        events = list(
            db.scalars(select(LifecycleEvent).where(LifecycleEvent.garment_id == UUID(gid)))
        )
        assert len(events) == 5


def test_w1_revoke_also_clears_w3_pending(wardrobe):  # noqa: F811
    from test_outfits import headers

    gid = str(wardrobe[0])
    candidate = {
        "garment_id": gid,
        "garment_version": 1,
        "decision_version": 0,
        "reason_key": "manual",
    }
    result = decide(candidate, "pending").json()["data"]
    response = client.post(
        f"/api/v1/garments/{gid}/lifecycle",
        headers=headers(),
        json={
            "expected_version": result["version"],
            "action": "decision",
            "occurred_on": "2026-01-01",
            "changes": {"decision": "undecided", "decision_reason": ""},
        },
    )
    assert response.status_code == 200, response.text
    assert board("pending")["candidates"] == []
    assert (
        next(c for c in board("all")["candidates"] if c["garment_id"] == gid)["state"]
        == "undecided"
    )
