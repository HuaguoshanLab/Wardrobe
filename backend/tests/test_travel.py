from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import func, select
from test_outfits import client, headers, wardrobe  # noqa: F401

from app.db.collections import WearRecord
from app.db.models import Job
from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.jobs.queue import claim
from app.jobs.worker import run_job
from app.schemas.collections import today

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]
ROOT = "/api/v1/travel-plans"


def payload(count=3, **changes):
    return {
        "name": "小旅行",
        "city": {"source": "manual", "name": "深圳", "adm1": "广东省"},
        "days": [
            {"date": str(today() + timedelta(days=i)), "occasion": "daily"} for i in range(count)
        ],
        "allow_repeat": True,
        "target_count": 3,
        **changes,
    }


def create(body=None, key=None):
    response = client.post(ROOT, json=body or payload(), headers=key or headers())
    assert response.status_code == 201, response.text
    return response.json()["data"]


def read(plan):
    return client.get(f"{ROOT}/{plan['id']}").json()["data"]


def generate(plan, **changes):
    response = client.post(
        f"{ROOT}/{plan['id']}/generate",
        json={"expected_version": plan["version"], **changes},
        headers=headers(),
    )
    assert response.status_code == 202, response.text
    item = claim()
    assert item and str(item[0]) == response.json()["data"]["job_id"]
    run_job(*item)
    job = client.get(f"/api/v1/jobs/{item[0]}").json()["data"]
    return read(plan), job


@pytest.mark.parametrize("days", [1, 7])
def test_full_plan_packing_snapshot_wear_and_versions(days, wardrobe):  # noqa: F811
    plan = create(payload(days, required_garment_ids=[str(wardrobe[-1])]))
    plan, job = generate(plan)
    assert job["status"] == "succeeded", job
    revision = plan["revision"]
    assert len(revision["days"]) == days
    assert len(plan["packing"]) == 4
    assert any("超过期望" in w for w in revision["warnings"])
    assert all(d["weather"]["source"] == "unknown" for d in revision["days"])
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(WearRecord)) == 0
    pack = plan["packing"][0]
    plan = client.post(
        f"{ROOT}/{plan['id']}/packing",
        headers=headers(),
        json={
            "expected_version": plan["version"],
            "garment_id": pack["garment_id"],
            "packed": True,
        },
    ).json()["data"]
    plan, job = generate(plan, adjust_date=str(today()), message="保持轻便")
    assert job["status"] == "succeeded", job
    assert plan["revision"]["days"][1:] == revision["days"][1:]
    assert next(p for p in plan["packing"] if p["garment_id"] == pack["garment_id"])["packed"]
    assert len(client.get(f"{ROOT}/{plan['id']}/revisions").json()["data"]) == 2
    body = {"revision_id": revision["id"], "day": str(today())}
    a = client.post(f"{ROOT}/{plan['id']}/wear", json=body, headers=headers())
    b = client.post(f"{ROOT}/{plan['id']}/wear", json=body, headers=headers())
    assert a.status_code == 200, a.text
    assert a.json()["data"] == b.json()["data"]
    if days > 1:
        assert (
            client.post(
                f"{ROOT}/{plan['id']}/wear",
                json={**body, "day": str(today() + timedelta(days=1))},
                headers=headers(),
            ).status_code
            == 422
        )
    with session_factory().begin() as db:
        garment = db.get(Garment, UUID(pack["garment_id"]))
        garment.attributes = {**garment.attributes, "name": "later change"}
        garment.version += 1
    assert client.get(f"{ROOT}/{plan['id']}/revisions").json()["data"][1] == revision
    assert client.get(pack["item"]["image_url"]).status_code == 200


def test_idempotency_busy_and_concurrent_versions():
    key = headers()
    plan = create(key=key)
    assert create(key=key) == plan
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda name: client.patch(
                    f"{ROOT}/{plan['id']}",
                    json={**payload(), "expected_version": 1, "name": name},
                    headers=headers(),
                ),
                ["A", "B"],
            )
        )
    assert sorted(r.status_code for r in responses) == [200, 409]
    plan = read(plan)
    key = headers()
    body = {"expected_version": plan["version"]}
    a = client.post(f"{ROOT}/{plan['id']}/generate", json=body, headers=key)
    b = client.post(f"{ROOT}/{plan['id']}/generate", json=body, headers=key)
    assert a.status_code == 202 and a.json()["data"] == b.json()["data"]
    plan = read(plan)
    assert (
        client.patch(
            f"{ROOT}/{plan['id']}",
            json={**payload(), "expected_version": plan["version"]},
            headers=headers(),
        ).status_code
        == 409
    )
    assert client.get(f"{ROOT}/{plan['id']}").status_code == 200
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0
        assert db.scalar(select(func.count()).select_from(Job)) == 1


@pytest.mark.parametrize("count", [0, 8])
def test_date_count_bounds(count):
    assert client.post(ROOT, json=payload(count), headers=headers()).status_code == 422


def test_dates_overlap_and_invalid_destination():
    p = payload()
    p["days"][1] = p["days"][0]
    assert client.post(ROOT, json=p, headers=headers()).status_code == 422
    assert (
        client.post(
            ROOT,
            json=payload(city={"source": "manual", "name": "香港", "adm1": "香港"}),
            headers=headers(),
        ).status_code
        == 422
    )


def test_repeat_disabled_and_required_conflict(wardrobe):  # noqa: F811
    plan, job = generate(create(payload(2, allow_repeat=False)))
    assert job["status"] == "succeeded", job
    first, second = plan["revision"]["days"]

    def base(day):
        return {i["garment_id"] for i in day["items"] if i["slot"] in {"top", "bottom", "dress"}}

    assert not base(first) & base(second)
    plan, job = generate(create(payload(7, allow_repeat=False)))
    assert job["status"] == "failed" and plan["revision"] is None
    plan = create(payload(required_garment_ids=[str(wardrobe[0])]))
    with session_factory().begin() as db:
        row = db.get(Garment, wardrobe[0])
        row.attributes = {**row.attributes, "availability": "unavailable"}
    assert (
        client.post(
            f"{ROOT}/{plan['id']}/generate", json={"expected_version": 1}, headers=headers()
        ).status_code
        == 409
    )


def test_failures_keep_previous_and_budget(monkeypatch):
    from app.providers import travel

    plan, job = generate(create())
    original = plan["revision"]
    monkeypatch.setattr(travel, "fake", lambda _: {"days": []})
    plan, job = generate(plan)
    assert job["status"] == "failed" and plan["revision"] == original
    with session_factory()() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(ModelCall)
                .where(ModelCall.job_id == UUID(job["id"]))
            )
            == 2
        )


def test_backup_references_and_roundtrip(tmp_path):
    from uuid import uuid4

    import psycopg

    from app.backup.database import export_data, import_data, load_data, media_keys, staging

    plan, _ = generate(create())
    path = tmp_path / "database.json"
    export_data(path)
    data = load_data(path)
    assert data["public.travel_plans"] and data["public.travel_revisions"]
    assert media_keys(data)
    with staging("wardrobe_restore_" + uuid4().hex, tmp_path) as url:
        with psycopg.connect(url) as connection:
            import_data(connection, data)
            row = connection.execute(
                "SELECT days FROM travel_revisions WHERE id=%s", (plan["revision"]["id"],)
            ).fetchone()
            assert row[0] == plan["revision"]["days"]
    data["public.outfit_images"] = []
    with pytest.raises(Exception, match="旅行图片引用缺失"):
        media_keys(data)


def test_unverified_forecast_city_is_rejected():
    body = payload(
        city={
            "id": "invented",
            "source": "qweather",
            "name": "深圳",
            "adm1": "广东省",
            "latitude": 22.54,
            "longitude": 114.06,
        }
    )
    assert client.post(ROOT, json=body, headers=headers()).status_code == 422
