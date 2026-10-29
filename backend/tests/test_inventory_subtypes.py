from uuid import UUID

import pytest
from test_inventory import demand, prepare, read, save
from test_outfits import client, headers, wardrobe  # noqa: F401

from app.db.session import session_factory
from app.db.wardrobe import Garment

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def subtype(category="top", name="衬衫"):
    r = client.post(
        "/api/v1/garment-subtypes", headers=headers(), json={"category": category, "name": name}
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]


def impact(sid):
    return client.get(f"/api/v1/garment-subtypes/{sid}/impact").json()["data"]


def test_subtype_impact_rename_disable_existing_references_and_cross_category(wardrobe):  # noqa: F811
    prepare(wardrobe)
    s = subtype()
    with session_factory().begin() as db:
        db.get(Garment, wardrobe[0]).subtype_id = UUID(s["id"])
    row = demand(subtype_ids=[s["id"]])
    assert save([row]).status_code == 200
    assert read()["counts"][0]["confirmed"] == 1
    preview = impact(s["id"])
    assert preview["garment_count"] == 1 and preview["rows"][0]["id"] == row["id"]
    payload = {
        "expected_version": s["version"],
        "name": "改名衬衫",
        "active": False,
        "impact_token": preview["token"],
    }
    key = headers()
    first = client.patch(f"/api/v1/garment-subtypes/{s['id']}", headers=key, json=payload)
    assert first.status_code == 200, first.text
    assert (
        client.patch(f"/api/v1/garment-subtypes/{s['id']}", headers=key, json=payload).json()[
            "data"
        ]
        == first.json()["data"]
    )
    assert read()["counts"][0]["confirmed"] == 1
    assert save([row]).status_code == 200
    assert save([row, demand(subtype_ids=[s["id"]])]).status_code == 422
    g = client.get(f"/api/v1/garments/{wardrobe[0]}").json()["data"]
    assert (
        client.patch(
            f"/api/v1/garments/{g['id']}",
            json={"expected_version": g["version"], "changes": {"name": "仍可编辑旧关联"}},
        ).status_code
        == 200
    )
    assert save([{**row, "category": "bottom"}]).status_code == 422
    new = subtype("bottom", "裤子")
    assert save([{**row, "subtype_ids": [new["id"]]}]).status_code == 422


def test_changed_impact_is_not_silently_confirmed():
    s = subtype()
    preview = impact(s["id"])
    save([demand(subtype_ids=[s["id"]])])
    r = client.patch(
        f"/api/v1/garment-subtypes/{s['id']}",
        headers=headers(),
        json={
            "expected_version": s["version"],
            "name": "新名",
            "active": False,
            "impact_token": preview["token"],
        },
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "IMPACT_CHANGED"
