from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

import pytest
from sqlalchemy import func, select
from test_outfits import client, generate, headers, wardrobe  # noqa: F401

from app.db.models import Job
from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.db.templates import ConditionTemplate
from app.schemas.profile import PreferencesPatch
from app.services import profile

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]
ROOT = "/api/v1/condition-templates"


def body(**fields):
    return {
        "name": "通勤",
        "conditions": {
            "occasion_codes": ["work"],
            "style_codes": None,
            "custom_tag_ids": [],
            "notes": "轻便",
            "rotation_mode": "less_worn",
            **fields,
        },
    }


def create(payload=None, key=None):
    response = client.post(ROOT, json=payload or body(), headers=key or headers())
    assert response.status_code == 201, response.text
    return response.json()["data"]


def patch(t, **changes):
    return {**body(), "expected_version": t["version"], **changes}


def test_crud_versions_replay_and_zero_model_work():
    key = headers()
    t = create(key=key)
    assert create(key=key) == t
    assert client.post(ROOT, json={**body(), "name": "different"}, headers=key).status_code == 409
    assert client.get(ROOT).json()["data"] == [t]
    update_key = headers()
    payload = patch(t, name="轻松通勤")
    changed = client.patch(ROOT + "/" + t["id"], json=payload, headers=update_key).json()["data"]
    assert changed["version"] == 2
    assert client.patch(ROOT + "/" + t["id"], json=payload, headers=headers()).status_code == 409
    assert (
        client.patch(ROOT + "/" + t["id"], json=payload, headers=update_key).json()["data"]
        == changed
    )
    delete_key = headers()
    delete_body = {"expected_version": 2}
    first = client.request("DELETE", ROOT + "/" + t["id"], json=delete_body, headers=delete_key)
    assert first.status_code == 200
    assert (
        client.request("DELETE", ROOT + "/" + t["id"], json=delete_body, headers=delete_key).json()[
            "data"
        ]
        == first.json()["data"]
    )
    assert client.get(ROOT).json()["data"] == []
    assert client.get(ROOT + "/" + t["id"]).status_code == 404
    assert create(key=key) == t  # Old request never resurrects a tombstone.
    assert client.get(ROOT).json()["data"] == []
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(Job)) == 0
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0


@pytest.mark.parametrize(
    "extra",
    [
        {"weather_override": None},
        {"season_codes": ["winter"]},
        {"locked_garment_ids": []},
        {"style_codes": ["unknown"]},
        {"rotation_mode": "invented"},
    ],
)
def test_reject_out_of_scope_or_unsupported_fields(extra):
    assert client.post(ROOT, json=body(**extra), headers=headers()).status_code == 422


def test_name_validation_and_concurrent_updates():
    assert client.post(ROOT, json={**body(), "name": "   "}, headers=headers()).status_code == 422
    t = create({**body(), "name": " 通勤 "})
    assert t["name"] == "通勤"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda name: (
                    client.patch(
                        ROOT + "/" + t["id"], json=patch(t, name=name), headers=headers()
                    ).status_code
                ),
                ["A", "B"],
            )
        )
    assert sorted(results) == [200, 409]


def test_concurrent_same_key_creates_one_template():
    key = headers()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: create(key=key), range(2)))
    assert results[0] == results[1]
    assert len(client.get(ROOT).json()["data"]) == 1


def test_deleted_tags_and_unsupported_legacy_fields_are_visible_and_repairable():
    tag = client.post("/api/v1/tags", json={"name": "通勤标签"}).json()["data"]
    t = create(body(custom_tag_ids=[tag["id"]]))
    assert (
        client.delete(
            "/api/v1/tags/" + tag["id"], headers={"If-Match": str(tag["version"])}
        ).status_code
        == 204
    )
    stale = client.get(ROOT + "/" + t["id"]).json()["data"]
    assert stale["issues"] and stale["conditions"]["custom_tag_ids"] == [tag["id"]]
    assert client.post("/api/v1/conditions/preview", json=stale["conditions"]).status_code == 422
    assert (
        client.patch(
            ROOT + "/" + t["id"], json=patch(t, conditions=stale["conditions"]), headers=headers()
        ).status_code
        == 422
    )
    with session_factory().begin() as db:
        row = db.get(ConditionTemplate, UUID(t["id"]))
        row.conditions = {**row.conditions, "obsolete": True}
    assert client.get(ROOT + "/" + t["id"]).json()["data"]["issues"]
    repaired = client.patch(ROOT + "/" + t["id"], json=patch(t), headers=headers())
    assert repaired.status_code == 200 and repaired.json()["data"]["issues"] == []


def test_preference_inheritance_empty_override_and_immutable_session_snapshot():
    pref = profile.preferences()
    profile.update_preferences(
        PreferencesPatch(expected_version=pref.version, preferences={"style_codes": ["casual"]}),
        "template-pref-1",
    )
    t = create()
    assert client.post("/api/v1/conditions/preview", json=t["conditions"]).json()["data"][
        "effective_preferences"
    ]["style_codes"] == ["casual"]
    pref = profile.preferences()
    profile.update_preferences(
        PreferencesPatch(expected_version=pref.version, preferences={"style_codes": ["minimal"]}),
        "template-pref-2",
    )
    inherited = client.post("/api/v1/conditions/preview", json=t["conditions"]).json()["data"]
    assert inherited["effective_preferences"]["style_codes"] == ["minimal"]
    unrestricted = create(body(style_codes=[]))
    assert (
        client.post("/api/v1/conditions/preview", json=unrestricted["conditions"]).json()["data"][
            "effective_preferences"
        ]["style_codes"]
        == []
    )
    s = client.post(
        "/api/v1/outfit-sessions",
        json={
            "requirements": {
                **t["conditions"],
                "weather_override": {"temperature_c": 20, "condition": "晴"},
            }
        },
        headers=headers(),
    ).json()["data"]
    s, _ = generate(s)
    before = client.get("/api/v1/outfit-revisions/" + s["selected_revision_id"]).json()["data"]
    assert (
        client.patch(
            ROOT + "/" + t["id"],
            json=patch(t, conditions=body(notes="新的条件")["conditions"]),
            headers=headers(),
        ).status_code
        == 200
    )
    assert (
        client.request(
            "DELETE", ROOT + "/" + t["id"], json={"expected_version": 2}, headers=headers()
        ).status_code
        == 200
    )
    assert (
        client.get("/api/v1/outfit-revisions/" + s["selected_revision_id"]).json()["data"] == before
    )


def test_template_limit_and_explicit_deleted_version():
    first = create()
    with session_factory().begin() as db:
        source = db.get(ConditionTemplate, UUID(first["id"]))
        for n in range(99):
            db.add(
                ConditionTemplate(
                    owner_id=source.owner_id, name=f"Template {n}", conditions=source.conditions
                )
            )
    assert len(client.get(ROOT).json()["data"]) == 100
    assert client.post(ROOT, json=body(), headers=headers()).status_code == 422
    assert (
        client.request(
            "DELETE", ROOT + "/" + first["id"], json={"expected_version": 2}, headers=headers()
        ).status_code
        == 409
    )
    assert (
        client.request(
            "DELETE", ROOT + "/" + first["id"], json={"expected_version": 1}, headers=headers()
        ).status_code
        == 200
    )
    assert create()["id"] != first["id"]
