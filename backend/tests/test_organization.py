from uuid import UUID

import pytest
from sqlalchemy import select
from test_inventory import demand, prepare, read, save
from test_outfits import client, headers, wardrobe  # noqa: F401
from test_supply import make

from app.db.lifecycle import LifecycleEvent
from app.db.session import session_factory
from app.db.wardrobe import Garment

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def board(state="active"):
    r = client.get("/api/v1/organization", params={"state": state, "limit": 100})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def decide(c, state, key=None):
    return client.post(
        f"/api/v1/organization/{c['garment_id']}/decision",
        headers=key or headers(),
        json={
            "garment_version": c["garment_version"],
            "expected_version": c["decision_version"],
            "reason_key": c["reason_key"],
            "state": state,
            "note": "我仍然需要这件",
        },
    )


def preview(gid):
    r = client.get(f"/api/v1/organization/{gid}/exit-impact")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def process(gid, impact, key=None, **values):
    return client.post(
        f"/api/v1/organization/{gid}/process",
        headers=key or headers(),
        json={
            "garment_version": impact["garment_version"],
            "impact_token": impact["token"],
            "action": "gifted",
            "occurred_on": "2026-01-01",
            "reason": "确认转赠",
            **values,
        },
    )


def test_shortages_plan_counts_not_stock_unknown_not_idle(wardrobe):  # noqa: F811
    prepare(wardrobe)
    a, b = demand(lower=4, upper=6), demand(lower=4, upper=6)
    save([a])
    save([b], "autumn")
    make(quantity=2, source_ids=[a["id"], b["id"]])
    result = board()
    assert [(s["difference"], s["planned"]) for s in result["shortages"]] == [(2, 2), (2, 2)]
    assert read()["counts"][0]["confirmed"] == 2
    save([{**a, "lower": 0, "upper": 0}])
    save([], "autumn")
    candidates = board()["candidates"]
    assert len(candidates) == 2 and all(c["reason_key"].startswith("excess:") for c in candidates)
    with session_factory().begin() as db:
        for g in db.scalars(select(Garment)):
            g.lifecycle = {}
    assert board()["candidates"] == []  # No records/unknown conditions never mean idle.


def test_keep_persists_same_reason_new_problem_and_revoke(wardrobe):  # noqa: F811
    prepare(wardrobe)
    row = demand(lower=0, upper=0)
    save([row])
    c = board()["candidates"][0]
    key = headers()
    kept = decide(c, "keep", key)
    assert kept.status_code == 200, kept.text
    assert decide(c, "keep", key).json()["data"] == kept.json()["data"]
    assert all(x["garment_id"] != c["garment_id"] for x in board()["candidates"])
    assert read()["counts"][0]["difference"] == 2  # Suppression is not count manipulation.
    save([{**row, "name": "重命名", "upper": 1}])
    assert all(x["garment_id"] != c["garment_id"] for x in board()["candidates"])
    with session_factory().begin() as db:
        g = db.get(Garment, UUID(c["garment_id"]))
        g.lifecycle = {**g.lifecycle, "fit": "unfit"}
        g.version += 1
    fresh = board()["candidates"]
    assert any(x["reason_key"] == "fit:unfit" and x["garment_id"] == c["garment_id"] for x in fresh)
    assert (
        client.get(f"/api/v1/garments/{c['garment_id']}").json()["data"]["lifecycle"]["decision"]
        == "keep"
    )
    keep = board("keep")["candidates"][0]
    assert decide(keep, "undecided").status_code == 200
    assert board("keep")["candidates"] == []


def test_w1_keep_and_revoke_sync_current_reasons(wardrobe):  # noqa: F811
    prepare(wardrobe)
    save([demand(lower=0, upper=0)])
    gid = wardrobe[0]
    for value in ["keep", "undecided"]:
        g = client.get(f"/api/v1/garments/{gid}").json()["data"]
        r = client.post(
            f"/api/v1/garments/{gid}/lifecycle",
            headers=headers(),
            json={
                "expected_version": g["version"],
                "action": "decision",
                "occurred_on": "2026-01-01",
                "changes": {"decision": value, "decision_reason": "主动决定"},
            },
        )
        assert r.status_code == 200, r.text
        assert any(x["garment_id"] == str(gid) for x in board()["candidates"]) == (
            value == "undecided"
        )


def test_exit_all_seasons_stale_evidence_and_idempotency(wardrobe):  # noqa: F811
    prepare(wardrobe)
    row = demand(lower=2, upper=3)
    save([row])
    save([demand(lower=2, upper=3)], "autumn")
    p = preview(wardrobe[0])
    assert len(p["rows"]) == 2
    assert all(r["after_confirmed"] == 1 and r["conclusion"] == "shortage" for r in p["rows"])
    save([{**row, "lower": 1}])
    assert process(wardrobe[0], p).status_code == 409
    assert client.get(f"/api/v1/garments/{wardrobe[0]}").json()["data"]["ownership"] == "owned"
    p = preview(wardrobe[0])
    key = headers()
    first = process(wardrobe[0], p, key)
    assert first.status_code == 200, first.text
    assert process(wardrobe[0], p, key).json()["data"] == first.json()["data"]
    assert first.json()["data"]["ownership"] == "retired"
    assert read()["counts"][0]["confirmed"] == 1
    with session_factory()() as db:
        assert (
            len(list(db.scalars(select(LifecycleEvent).where(LifecycleEvent.action == "retire"))))
            == 1
        )


def test_preview_rejects_new_inventory_unknown_and_repair(wardrobe):  # noqa: F811
    prepare(wardrobe)
    save([demand(lower=2, upper=3)])
    p = preview(wardrobe[0])
    with session_factory().begin() as db:
        g = db.get(Garment, wardrobe[1])
        g.lifecycle = {}
        g.version += 1
    assert process(wardrobe[0], p).status_code == 409
    p = preview(wardrobe[0])
    assert p["rows"][0]["after_pending"] == 1
    assert p["rows"][0]["conclusion"] == "shortage"
    repaired = process(wardrobe[0], p, action="repair", impact_token=None)
    assert repaired.status_code == 200
    g = repaired.json()["data"]
    assert g["ownership"] == "owned" and g["availability"] == "unavailable"
    assert g["lifecycle"]["unavailable_reason"] == "repair"
    assert board("repair")["candidates"]
    finished = client.post(
        f"/api/v1/garments/{wardrobe[0]}/lifecycle",
        headers=headers(),
        json={
            "expected_version": g["version"],
            "action": "repair_complete",
            "occurred_on": "2026-01-02",
            "changes": {"condition": "good", "availability": "available"},
        },
    )
    assert finished.status_code == 200, finished.text
    assert board("repair")["candidates"] == []
    assert board("observe")["candidates"][0]["garment_id"] == str(wardrobe[0])


def test_manual_observation_not_exit_and_plan_change_does_not_remove_decision(wardrobe):  # noqa: F811
    c = {
        "garment_id": str(wardrobe[0]),
        "garment_version": 1,
        "decision_version": 0,
        "reason_key": "manual",
    }
    assert decide(c, "observe").status_code == 200
    row = board("observe")["candidates"][0]
    assert decide(row, "pending").status_code == 200
    g = client.get(f"/api/v1/garments/{wardrobe[0]}").json()["data"]
    assert g["ownership"] == "owned" and g["lifecycle"]["decision"] == "pending"
    assert decide(row, "keep").status_code == 409
    assert board("pending")["candidates"][0]["reason_key"] == "manual"


def test_legacy_exit_also_requires_preview_and_inventory_insert_invalidates(wardrobe):  # noqa: F811
    prepare(wardrobe)
    save([demand(lower=2, upper=3)])
    gid = wardrobe[0]
    current = client.get(f"/api/v1/garments/{gid}").json()["data"]
    candidate = {
        "garment_id": str(gid),
        "garment_version": current["version"],
        "decision_version": 0,
        "reason_key": "manual",
    }
    assert decide(candidate, "keep").status_code == 200
    g = client.get(f"/api/v1/garments/{gid}").json()["data"]
    body = {
        "expected_version": g["version"],
        "action": "retire",
        "occurred_on": "2026-01-01",
        "changes": {"exit_reason": "sold"},
    }
    response = client.post(f"/api/v1/garments/{gid}/lifecycle", headers=headers(), json=body)
    assert response.status_code == 409 and response.json()["error"]["code"] == "IMPACT_CHANGED"
    p = preview(gid)
    with session_factory().begin() as db:
        old = db.get(Garment, gid)
        db.add(
            Garment(
                owner_id=old.owner_id,
                image_asset_id=old.image_asset_id,
                attributes=old.attributes,
                lifecycle=old.lifecycle,
            )
        )
    assert process(gid, p).status_code == 409
    p = preview(gid)
    response = client.post(
        f"/api/v1/garments/{gid}/lifecycle",
        headers=headers(),
        json={**body, "impact_token": p["token"]},
    )
    assert response.status_code == 200
    assert any(c["garment_id"] == str(gid) for c in board("done")["candidates"])
    history = client.get(f"/api/v1/garments/{gid}/lifecycle").json()["data"]
    restored = client.post(
        f"/api/v1/garments/{gid}/lifecycle",
        headers=headers(),
        json={
            "expected_version": response.json()["data"]["version"],
            "action": "restore",
            "occurred_on": "2026-01-02",
            "reason": "误退出，恢复核对",
            "related_event_id": history["last_exit_event_id"],
            "changes": {"availability": "available"},
        },
    )
    assert restored.status_code == 200, restored.text
    assert any(c["garment_id"] == str(gid) for c in board("observe")["candidates"])
