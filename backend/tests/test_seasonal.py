from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from test_inventory import demand, prepare, save
from test_outfits import client, headers, wardrobe  # noqa: F401

from app.db.lifecycle import LifecycleEvent
from app.db.models import utcnow
from app.db.seasonal import SeasonalAction
from app.db.session import session_factory
from app.db.wardrobe import Garment

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]
ROOT = "/api/v1/seasonal-sessions"


def create(**values):
    r = client.post(
        ROOT, headers=headers(), json={"id": str(uuid4()), "season": "summer", **values}
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]


def read(s):
    r = client.get(f"{ROOT}/{s['id']}")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def progress(s, **values):
    return client.post(
        f"{ROOT}/{s['id']}/progress",
        headers=headers(),
        json={
            "expected_version": s["version"],
            "stage": "review",
            **values,
        },
    )


def reviewed(s):
    r = progress(
        s,
        target_token=s["target_token"],
        items=[
            {
                "garment_id": i["garment_id"],
                "garment_version": i["current"]["version"],
                "reviewed": True,
                "todo": "稍后处理",
            }
            for i in s["items"]
            if i["current"]
        ],
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]


def action(i, **values):
    return {
        "id": str(uuid4()),
        "garment_id": i["garment_id"],
        "operation": {
            "expected_version": i["current"]["version"],
            "action": "storage",
            "occurred_on": "2026-01-01",
            "changes": {"storage": "stored"},
            **values,
        },
    }


def batch(s, items, key=None):
    return client.post(f"{ROOT}/{s['id']}/actions", headers=key or headers(), json={"items": items})


def finish(s, **values):
    return client.post(
        f"{ROOT}/{s['id']}/complete",
        headers=headers(),
        json={
            "expected_version": s["version"],
            "preview_token": s["preview_token"],
            "acknowledge_unresolved": True,
            **values,
        },
    )


def test_scope_progress_resume_conflicts_no_real_changes(wardrobe):  # noqa: F811
    prepare(wardrobe)
    with session_factory().begin() as db:
        db.get(Garment, wardrobe[0]).attributes = {"category": "top", "seasons": ["winter"]}
    s = create(categories=["top"])
    assert len(s["items"]) == 1
    assert create(season="spring", categories=["top"])["items"] == []
    s = reviewed(s)
    assert read(s)["preview"]["reviewed"] == 1
    assert read(s)["items"][0]["todo"] == "稍后处理"
    assert read(s)["items"][0]["current"]["lifecycle"]["storage"] == "daily"
    assert progress(s, expected_version=1).status_code == 409
    gid = UUID(s["items"][0]["garment_id"])
    with session_factory().begin() as db:
        g = db.get(Garment, gid)
        g.version += 1
    assert read(s)["items"][0]["stale"]
    assert finish(read(s)).status_code == 409
    s = reviewed(read(s))
    assert not s["items"][0]["stale"]
    assert client.get(ROOT).json()["data"]["items"]


def test_batch_partial_success_idempotency_and_retry_only_failed():
    s = reviewed(create(categories=["top"]))
    a, b = [action(i) for i in s["items"]]
    b["operation"]["expected_version"] += 1
    key = headers()
    r = batch(s, [a, b], key)
    assert r.status_code == 200, r.text
    result = r.json()["data"]
    assert [i["success"] for i in result["items"]] == [True, False]
    assert batch(s, [a, b], key).json()["data"] == result
    assert batch(s, [a, b]).json()["data"] == result
    fresh = read(s)
    failed = next(i for i in fresh["items"] if i["garment_id"] == b["garment_id"])
    assert batch(s, [action(failed)]).json()["data"]["items"][0]["success"]
    assert all(i["todo"] == "稍后处理" for i in read(s)["items"])
    assert read(s)["preview"]["reviewed"] == 2
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(LifecycleEvent)) == 2
        assert db.scalar(select(func.count()).select_from(SeasonalAction)) == 3
    assert (
        batch(s, [{**a, "operation": {**a["operation"], "reason": "different"}}]).status_code == 409
    )


def test_target_and_completion_preview_stale_then_immutable(wardrobe):  # noqa: F811
    prepare(wardrobe)
    row = demand()
    save([row])
    s = reviewed(create(categories=["top"]))
    save([{**row, "lower": 4}])
    assert not read(s)["targets_confirmed"]
    assert progress(s, target_token=s["target_token"]).status_code == 409
    s = reviewed(read(s))
    assert finish(s, acknowledge_unresolved=False).status_code == 409
    assert batch(s, [action(s["items"][0])]).status_code == 200
    assert finish(s).status_code == 409
    s = read(s)
    r = finish(s)
    assert r.status_code == 200, r.text
    completed = r.json()["data"]
    with session_factory().begin() as db:
        for g in db.scalars(select(Garment)):
            g.version += 1
            g.deleted_at = utcnow()
    save([])
    assert read(completed) == completed
    assert progress(completed).status_code == 409
    assert batch(completed, [action(s["items"][1])]).status_code == 409
    assert create(categories=["top"])["items"] == []


def test_retirement_refresh_impact_and_deleted_item_remains(wardrobe):  # noqa: F811
    prepare(wardrobe)
    save([demand(lower=2, upper=3)])
    s = reviewed(create(categories=["top"]))
    first = s["items"][0]
    gid = first["garment_id"]
    a = action(first, action="retire", changes={"exit_reason": "gifted"})
    assert not batch(s, [a]).json()["data"]["items"][0]["success"]
    impact = client.get(f"/api/v1/organization/{gid}/exit-impact").json()["data"]
    a = action(
        first, action="retire", changes={"exit_reason": "gifted"}, impact_token=impact["token"]
    )
    assert batch(s, [a]).json()["data"]["items"][0]["success"]
    assert not batch(s, [action(first)]).json()["data"]["items"][0]["success"]
    with session_factory().begin() as db:
        db.get(Garment, UUID(s["items"][1]["garment_id"])).deleted_at = utcnow()
    s = read(s)
    assert s["preview"]["unresolved"]
    assert finish(s).status_code == 200
