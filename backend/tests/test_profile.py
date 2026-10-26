from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import Job
from app.db.profile import Profile
from app.db.session import session_factory
from app.main import app
from app.schemas.profile import Preferences, PreferencesPatch
from app.services.profile import preferences, update_preferences

pytestmark = pytest.mark.integration


def reset_profile() -> None:
    with session_factory().begin() as db:
        row = db.scalars(select(Profile)).first()
        if row:
            db.delete(row)


def test_preferences_versions_idempotency_and_unknown(clean_db: None) -> None:
    reset_profile()
    client = TestClient(app)
    original = client.get("/api/v1/profile/preferences").json()["data"]
    assert original["preferences"]["fit"] is None
    payload = {
        "expected_version": original["version"],
        "preferences": {"style_codes": ["casual"], "thermal": "cold_sensitive"},
    }
    headers = {"Idempotency-Key": str(uuid4())}
    first = client.patch("/api/v1/profile/preferences", json=payload, headers=headers)
    assert first.status_code == 200
    again = client.patch("/api/v1/profile/preferences", json=payload, headers=headers)
    assert first.json()["data"] == again.json()["data"]
    assert (
        client.patch(
            "/api/v1/profile/preferences", json=payload, headers={"Idempotency-Key": str(uuid4())}
        ).status_code
        == 409
    )
    assert (
        client.patch(
            "/api/v1/profile/preferences",
            json={**payload, "preferences": {"style_codes": ["invented"]}},
            headers=headers,
        ).status_code
        == 422
    )
    # Clearing preserves unknown, never invents a preference.
    clear = client.patch(
        "/api/v1/profile/preferences",
        json={"expected_version": 2, "preferences": {"thermal": None}},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert clear.json()["data"]["preferences"]["thermal"] is None
    assert clear.json()["data"]["preferences"]["style_codes"] == ["casual"]
    # Missing and explicit null have different PATCH semantics and request hashes.
    key = {"Idempotency-Key": str(uuid4())}
    assert (
        client.patch(
            "/api/v1/profile/preferences",
            json={"expected_version": 3, "preferences": {}},
            headers=key,
        ).status_code
        == 200
    )
    assert (
        client.patch(
            "/api/v1/profile/preferences",
            json={"expected_version": 3, "preferences": {"notes": None}},
            headers=key,
        ).status_code
        == 409
    )


def test_concurrent_preferences_do_not_overwrite(clean_db: None) -> None:
    reset_profile()
    before = preferences()

    def save(style: str) -> int:
        with TestClient(app) as client:
            return client.patch(
                "/api/v1/profile/preferences",
                json={
                    "expected_version": before.version,
                    "preferences": {"style_codes": [style]},
                },
                headers={"Idempotency-Key": str(uuid4())},
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, ["classic", "minimal"])) == [200, 409]


def test_manual_location_and_conditions_priority(clean_db: None) -> None:
    reset_profile()
    client = TestClient(app)
    pref = preferences()
    update_preferences(
        PreferencesPatch(
            expected_version=pref.version, preferences=Preferences(style_codes=["casual"])
        ),
        str(uuid4()),
    )
    location = client.get("/api/v1/profile/location").json()["data"]
    city = {"name": "杭州", "adm1": "浙江省", "source": "manual"}
    payload = {"city": city, "expected_version": location["version"]}
    assert (
        client.patch(
            "/api/v1/profile/location", json=payload, headers={"Idempotency-Key": str(uuid4())}
        ).status_code
        == 200
    )
    restored = client.get("/api/v1/profile/location").json()["data"]
    assert restored["city"]["name"] == "杭州" and restored["city"]["latitude"] is None
    outside = {**payload, "city": {**city, "adm1": "香港"}}
    assert (
        client.patch(
            "/api/v1/profile/location", json=outside, headers={"Idempotency-Key": str(uuid4())}
        ).status_code
        == 422
    )
    forged = {
        **payload,
        "city": {**city, "source": "qweather", "id": "fake", "latitude": 30, "longitude": 120},
        "expected_version": restored["version"],
    }
    assert (
        client.patch(
            "/api/v1/profile/location", json=forged, headers={"Idempotency-Key": str(uuid4())}
        ).status_code
        == 422
    )
    initial = client.post("/api/v1/conditions/preview", json={}).json()["data"]
    assert initial["effective_preferences"]["style_codes"] == ["casual"]
    overridden = client.post(
        "/api/v1/conditions/preview",
        json={"style_codes": [], "weather_override": {"temperature_c": 0, "condition": "下雪"}},
    )
    assert overridden.json()["data"]["effective_preferences"]["style_codes"] == []
    assert overridden.json()["data"]["requirements"]["weather_override"]["temperature_c"] == 0
    assert preferences().preferences.style_codes == ["casual"]
    assert (
        client.post(
            "/api/v1/conditions/preview", json={"custom_tag_ids": [str(uuid4())]}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/conditions/preview", json={"weather_override": {"condition": " "}}
        ).status_code
        == 422
    )
    with session_factory()() as db:
        assert db.scalars(select(Job)).all() == []
