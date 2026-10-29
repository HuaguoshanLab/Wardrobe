"""An executed action is not proof that arbitrary user-authored tasks are done."""

import pytest
from test_outfits import wardrobe  # noqa: F401
from test_seasonal import action, batch, create, finish, progress, read, reviewed

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_storage_preserves_unrelated_todo_until_explicit_review():
    s = reviewed(create(categories=["top"]))
    i = s["items"][0]
    task = "试穿后检查袖口是否需要改短"
    s = progress(
        s,
        items=[
            {
                "garment_id": i["garment_id"],
                "garment_version": i["current"]["version"],
                "reviewed": True,
                "todo": task,
            }
        ],
    ).json()["data"]
    assert batch(s, [action(i)]).json()["data"]["items"][0]["success"]
    fresh = read(s)
    current = next(x for x in fresh["items"] if x["garment_id"] == i["garment_id"])
    assert current["todo"] == task
    assert any(task in t for t in fresh["preview"]["unresolved"])
    assert finish(fresh, acknowledge_unresolved=False).status_code == 409
    response = progress(
        fresh,
        items=[
            {
                "garment_id": current["garment_id"],
                "garment_version": current["current"]["version"],
                "reviewed": True,
                "todo": "",
            }
        ],
    )
    assert response.status_code == 200
    assert all(task not in t for t in response.json()["data"]["preview"]["unresolved"])
