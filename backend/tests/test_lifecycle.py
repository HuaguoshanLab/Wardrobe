from concurrent.futures import ThreadPoolExecutor
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from test_outfits import client, current, generate, headers, session, wardrobe  # noqa: F401

from app.db.models import utcnow
from app.db.outfits import OutfitRevision
from app.db.session import session_factory
from app.jobs.queue import claim
from app.jobs.worker import run_job

pytestmark = pytest.mark.integration
TODAY = str(utcnow().astimezone(ZoneInfo("Asia/Shanghai")).date())


def read(gid):
    return client.get(f"/api/v1/garments/{gid}").json()["data"]


def act(gid, action, changes=None, **extra):
    if action == "retire" and "impact_token" not in extra:
        response = client.get(f"/api/v1/organization/{gid}/exit-impact")
        if response.status_code == 200:
            extra["impact_token"] = response.json()["data"]["token"]
    return client.post(
        f"/api/v1/garments/{gid}/lifecycle",
        headers=headers(),
        json={
            "expected_version": read(gid)["version"],
            "action": action,
            "occurred_on": TODAY,
            "changes": changes or {},
            **extra,
        },
    )


def history(gid):
    return client.get(f"/api/v1/garments/{gid}/lifecycle").json()["data"]


def test_unknown_profile_precision_subtype_and_old_edit(wardrobe):  # noqa: F811  # noqa: F811
    gid = wardrobe[0]
    original = read(gid)
    assert original["lifecycle"]["acquired_on"] is None
    assert original["lifecycle"]["condition"] == "unknown"
    assert original["availability"] == "available"
    subtype = client.post(
        "/api/v1/garment-subtypes", headers=headers(), json={"category": "top", "name": "衬衫"}
    ).json()["data"]
    response = act(gid, "profile", {"price": "0.00", "subtype_id": subtype["id"], "source": "gift"})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["lifecycle"]["price"] == "0.00"
    assert act(gid, "profile", {"price": "1.234"}).status_code == 422
    assert act(gid, "profile", {"acquired_on": "2099-01-01"}).status_code == 422
    assert act(gid, "profile", {"ownership": "retired"}).status_code == 422
    changed = client.patch(
        f"/api/v1/garments/{gid}",
        json={"expected_version": read(gid)["version"], "changes": {"category": "bottom"}},
    )
    assert changed.status_code == 422
    assert act(gid, "profile", {"subtype_id": None}).status_code == 200
    assert read(gid)["created_at"] == original["created_at"]
    assert history(gid)["wear_days"] == 0


def test_storage_repair_decision_and_availability_are_separate(wardrobe):  # noqa: F811
    gid = wardrobe[0]
    assert (
        act(
            gid, "availability", {"availability": "unavailable", "unavailable_reason": "washing"}
        ).status_code
        == 200
    )
    for storage in ["stored", "daily"]:
        assert act(gid, "storage", {"storage": storage, "location": "衣柜"}).status_code == 200
        item = read(gid)
        assert item["availability"] == "unavailable"
        assert item["lifecycle"]["unavailable_reason"] == "washing"
    assert act(gid, "condition", {"condition": "needs_repair"}).status_code == 200
    assert read(gid)["lifecycle"]["unavailable_reason"] == "washing"
    assert act(gid, "repair_start").status_code == 200
    assert act(gid, "repair_complete", {"condition": "good"}).status_code == 422
    assert (
        act(
            gid,
            "repair_complete",
            {"condition": "good", "availability": "unavailable", "unavailable_reason": "washing"},
        ).status_code
        == 200
    )
    assert read(gid)["lifecycle"]["unavailable_reason"] == "washing"
    assert act(gid, "decision", {"decision": "keep", "decision_reason": "纪念"}).status_code == 200
    assert act(gid, "decision", {"decision": "pending"}).status_code == 200
    assert read(gid)["ownership"] == "owned"
    assert act(gid, "decision", {"decision": "undecided"}).status_code == 200


def test_retire_idempotence_concurrency_restore_correction_and_delete(wardrobe):  # noqa: F811
    gid = wardrobe[0]
    item = read(gid)
    payload = {
        "expected_version": item["version"],
        "action": "retire",
        "impact_token": client.get(f"/api/v1/organization/{gid}/exit-impact").json()["data"][
            "token"
        ],
        "occurred_on": TODAY,
        "changes": {"exit_reason": "gifted"},
    }
    key = headers()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _: client.post(
                    f"/api/v1/garments/{gid}/lifecycle", headers=key, json=payload
                ),
                range(2),
            )
        )
    assert all(r.status_code == 200 for r in responses)
    assert responses[0].json()["data"] == responses[1].json()["data"]
    event = history(gid)["items"][0]
    assert len(history(gid)["items"]) == 1
    assert (
        client.post(
            f"/api/v1/garments/{gid}/lifecycle", headers=key, json={**payload, "reason": "不同内容"}
        ).status_code
        == 409
    )
    assert act(gid, "retire", {"exit_reason": "sold"}).status_code == 409
    assert (
        client.post(
            f"/api/v1/garments/{gid}/lifecycle", headers=headers(), json=payload
        ).status_code
        == 409
    )
    assert str(gid) not in [g["id"] for g in client.get("/api/v1/garments").json()["data"]["items"]]
    assert client.get("/api/v1/garments?ownership=retired").json()["data"]["items"][0]["id"] == str(
        gid
    )
    assert client.get(item["image_url"]).status_code == 200
    assert (
        act(gid, "correct", related_event_id=event["id"], reason="去向补充：转赠给家人").status_code
        == 200
    )
    assert history(gid)["items"][-1] == event
    assert read(gid)["ownership"] == "retired"
    assert (
        act(
            gid,
            "restore",
            {"availability": "unavailable", "unavailable_reason": "washing"},
            related_event_id=event["id"],
            reason="误操作",
        ).status_code
        == 200
    )
    assert read(gid)["id"] == str(gid) and read(gid)["ownership"] == "owned"
    assert (
        act(
            gid,
            "restore",
            {"availability": "available"},
            related_event_id=event["id"],
            reason="重复",
        ).status_code
        == 409
    )
    page = client.get(f"/api/v1/garments/{gid}/lifecycle?limit=1").json()["data"]
    assert page["next_cursor"] is not None
    assert page["last_exit_event_id"] == event["id"]
    assert (
        client.get(f"/api/v1/garments/{gid}/lifecycle?cursor={page['next_cursor']}").json()["data"][
            "items"
        ][0]["action"]
        == "correct"
    )
    assert (
        client.delete(
            f"/api/v1/garments/{gid}", headers={"If-Match": str(read(gid)["version"])}
        ).status_code
        == 204
    )
    assert client.get(f"/api/v1/garments/{gid}").status_code == 404
    assert client.get("/api/v1/garments?ownership=retired").json()["data"]["items"] == []


def test_retired_excluded_lock_preserved_history_and_wear_days(wardrobe):  # noqa: F811
    saved, _ = generate(session())
    revision = saved["revisions"][0]
    gid = next(i["garment_id"] for i in revision["items"] if i["source"] == "wardrobe")
    locked = client.patch(
        f"/api/v1/outfit-sessions/{saved['id']}",
        headers=headers(),
        json={"expected_version": saved["version"], "locked_garment_ids": [gid]},
    ).json()["data"]
    image = next(i["image_url"] for i in revision["items"] if i["image_url"])
    pixels = client.get(image).content
    with session_factory().begin() as db:
        second = db.get(OutfitRevision, UUID(saved["revisions"][1]["id"]))
        second.items = revision["items"]  # Fixture with two revisions wearing the same garment.
    for rid in [revision["id"], saved["revisions"][1]["id"]]:
        result = client.post(
            "/api/v1/wear-records", headers=headers(), json={"revision_id": rid, "worn_on": TODAY}
        )
        assert result.status_code == 201, result.text
    assert history(gid)["wear_days"] == 1
    assert act(gid, "retire", {"exit_reason": "recycled"}).status_code == 200
    # Even legacy availability edits cannot bypass the ownership exclusion.
    client.patch(
        f"/api/v1/garments/{gid}",
        json={"expected_version": read(gid)["version"], "changes": {"availability": "available"}},
    )
    reselection = client.patch(
        f"/api/v1/outfit-sessions/{saved['id']}",
        headers=headers(),
        json={"expected_version": locked["version"], "selected_revision_id": revision["id"]},
    )
    assert reselection.status_code == 200
    locked = reselection.json()["data"]
    assert locked["removed_lock_ids"] == []
    now = current()
    assert gid in now["invalid_garment_ids"] and now["locked_garment_ids"] == [gid]
    result = client.post(
        f"/api/v1/outfit-sessions/{saved['id']}/generate",
        headers=headers(),
        json={"expected_version": locked["version"]},
    )
    assert result.status_code == 409
    assert client.get(f"/api/v1/outfit-revisions/{revision['id']}").json()["data"] == revision
    assert client.get(image).content == pixels
    fresh, _ = generate(session())
    assert gid not in [i["garment_id"] for r in fresh["revisions"] for i in r["items"]]


def test_retirement_between_context_and_commit_fails(wardrobe, monkeypatch):  # noqa: F811
    from app.agent import outfits as calls

    original = calls.model_call

    def retire_after_model(*args, **kwargs):
        assert all("lifecycle" not in candidate for candidate in args[4].candidates)
        result = original(*args, **kwargs)
        gid = result["outfits"][0]["garment_ids"][0]
        assert act(gid, "retire", {"exit_reason": "discarded"}).status_code == 200
        return result

    monkeypatch.setattr(calls, "model_call", retire_after_model)
    s = session()
    response = client.post(
        f"/api/v1/outfit-sessions/{s['id']}/generate",
        headers=headers(),
        json={"expected_version": s["version"]},
    )
    run_job(*claim())
    job = client.get("/api/v1/jobs/" + response.json()["data"]["job_id"]).json()["data"]
    assert job["status"] == "failed", job
    assert job["error"]["code"] == "CONSTRAINT_CONFLICT", job
    assert current()["revisions"] == []
