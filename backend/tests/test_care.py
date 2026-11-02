from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from test_outfits import client, headers, wardrobe  # noqa: F401

from app.db.lifecycle import LifecycleEvent
from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.db.wardrobe import Garment

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]
ROOT = "/api/v1/wardrobe/care"


def item(gid, action="mark_washing", version=1, **extra):
    return dict(
        id=str(uuid4()), garment_id=str(gid), expected_version=version, action=action, **extra
    )


def batch(items, key=None):
    return client.post(ROOT + "/actions", headers=key or headers(), json={"items": items})


def read(gid):
    return client.get(f"/api/v1/garments/{gid}").json()["data"]


def test_washing_roundtrip_preserves_storage_snapshots_and_no_models(wardrobe):  # noqa: F811
    gid = wardrobe[0]
    with session_factory().begin() as db:
        db.get(Garment, gid).lifecycle = {
            "storage": "stored",
            "location": "衣柜 A",
            "notes": "保留",
        }
    manual = client.post(
        "/api/v1/manual-outfits",
        headers=headers(),
        json={
            "mode": "save",
            "items": [{"garment_id": str(gid), "expected_version": 1}],
        },
    ).json()["data"]["revision"]
    first = batch([item(gid)]).json()["data"]["items"][0]
    assert first["success"] and first["changed"]
    g = first["garment"]
    assert g["availability"] == "unavailable" and g["lifecycle"]["unavailable_reason"] == "washing"
    assert [g["id"] for g in client.get(ROOT).json()["data"]["items"]] == [str(gid)]
    last = batch([item(gid, "wash_done", g["version"])]).json()["data"]["items"][0]
    assert last["garment"]["availability"] == "available"
    assert last["garment"]["lifecycle"]["unavailable_reason"] is None
    assert last["garment"]["lifecycle"]["storage"] == "stored"
    assert last["garment"]["lifecycle"]["location"] == "衣柜 A"
    assert client.get(f"/api/v1/outfit-revisions/{manual['id']}").json()["data"] == manual
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(LifecycleEvent)) == 2
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0


def test_partial_results_replay_and_retry_only_failed(wardrobe):  # noqa: F811
    a, b = wardrobe[:2]
    with session_factory().begin() as db:
        g = db.get(Garment, b)
        g.attributes = {**g.attributes, "availability": "unavailable"}
        g.lifecycle = {"unavailable_reason": "repair", "condition": "needs_repair"}
    values, key = [item(a), item(b)], headers()
    result = batch(values, key).json()["data"]
    assert [r["success"] for r in result["items"]] == [True, False]
    assert result["items"][1]["code"] == "STATE_CONFLICT"
    assert batch(values, key).json()["data"] == result
    assert batch(values).json()["data"] == result
    batch([item(a, "location_set", 2, location="新位置")])
    assert batch(values).json()["data"] == result
    assert read(a)["lifecycle"]["location"] == "新位置"
    assert read(b)["lifecycle"]["unavailable_reason"] == "repair"
    assert not batch([item(b, "wash_done")]).json()["data"]["items"][0]["success"]
    with session_factory().begin() as db:
        g = db.get(Garment, b)
        g.attributes = {**g.attributes, "availability": "available"}
        g.lifecycle = {**g.lifecycle, "unavailable_reason": None}
        g.version += 1
    assert batch([item(b, version=2)]).json()["data"]["items"][0]["success"]
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(LifecycleEvent)) == 3
    assert batch([{**values[0], "action": "wash_done"}]).status_code == 409
    assert batch([values[0]], key).status_code == 409


def test_tags_are_set_deltas_and_location_is_independent(wardrobe):  # noqa: F811
    gid = wardrobe[0]
    a, b = [
        client.post("/api/v1/tags", json={"name": n}).json()["data"]["id"] for n in ["保留", "添加"]
    ]
    client.patch(
        f"/api/v1/garments/{gid}", json={"expected_version": 1, "changes": {"custom_tag_ids": [a]}}
    )
    added = batch([item(gid, "tags_add", 2, tag_ids=[b])]).json()["data"]["items"][0]
    assert added["garment"]["custom_tag_ids"] == [a, b]
    same = batch([item(gid, "tags_add", 3, tag_ids=[b])]).json()["data"]["items"][0]
    assert same["success"] and not same["changed"] and same["garment"]["version"] == 3
    removed = batch([item(gid, "tags_remove", 3, tag_ids=[b])]).json()["data"]["items"][0]
    assert removed["garment"]["custom_tag_ids"] == [a]
    located = batch([item(gid, "location_set", 4, location="  衣柜第二层  ")]).json()["data"][
        "items"
    ][0]
    assert located["garment"]["lifecycle"]["location"] == "衣柜第二层"
    clear = batch([item(gid, "location_clear", 5)]).json()["data"]["items"][0]
    assert clear["garment"]["lifecycle"]["location"] is None
    assert clear["garment"]["custom_tag_ids"] == [a]
    assert clear["garment"]["availability"] == "available"


def test_deleted_tags_and_stale_retired_deleted_demo_items(wardrobe):  # noqa: F811
    a, b, c, d, e, f = wardrobe
    t = client.post("/api/v1/tags", json={"name": "删除"}).json()["data"]
    assert client.delete(f"/api/v1/tags/{t['id']}", headers={"If-Match": "1"}).status_code == 204
    with session_factory().begin() as db:
        db.get(Garment, b).ownership = "retired"
        db.get(Garment, c).is_demo = True
        db.get(Garment, d).version = 2
    assert client.delete(f"/api/v1/garments/{e}", headers={"If-Match": "1"}).status_code == 204
    results = batch(
        [item(a, "tags_add", tag_ids=[t["id"]]), item(b), item(c), item(d), item(e), item(f)]
    ).json()["data"]["items"]
    assert [r["success"] for r in results] == [False] * 5 + [True]
    assert [r["code"] for r in results[:5]] == [
        "TAG_NOT_FOUND",
        "INVALID_GARMENT",
        "INVALID_GARMENT",
        "VERSION_CONFLICT",
        "NOT_FOUND",
    ]
    listed = client.get(ROOT + "?group=all").json()["data"]["items"]
    assert {g["id"] for g in listed} == {str(a), str(d), str(f)}


@pytest.mark.parametrize(
    "action,extra",
    [
        ("tags_add", {}),
        ("location_set", {"location": "  "}),
        ("location_clear", {"location": ""}),
        ("mark_washing", {"tag_ids": [str(uuid4())]}),
        ("unknown", {}),
    ],
)
def test_rejects_ambiguous_action_fields(wardrobe, action, extra):  # noqa: F811
    assert batch([item(wardrobe[0], action, **extra)]).status_code == 422


def test_batch_boundaries_and_query_pagination(wardrobe):  # noqa: F811
    assert batch([]).status_code == 422
    assert batch([item(uuid4()) for _ in range(21)]).status_code == 422
    assert batch([item(wardrobe[0]), item(wardrobe[0])]).status_code == 422
    cursor = None
    ids = []
    for _ in range(3):
        page = client.get(
            ROOT, params={"group": "all", "limit": 2, **({"cursor": cursor} if cursor else {})}
        ).json()["data"]
        ids += [g["id"] for g in page["items"]]
        cursor = page["next_cursor"]
    assert len(set(ids)) == 6 and cursor is None
    assert client.get(ROOT + "?group=unknown").status_code == 422
    assert client.get(ROOT + "?limit=101").status_code == 422


def test_concurrent_batches_allow_only_one_old_version(wardrobe):  # noqa: F811
    def send(_):
        return batch([item(wardrobe[0])]).json()["data"]["items"][0]

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(send, range(2)))
    assert sum(r["success"] for r in results) == 1
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(LifecycleEvent)) == 1
