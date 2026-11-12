from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import func, select
from test_outfits import client, headers, wardrobe  # noqa: F401
from test_travel import ROOT, create, generate, payload, read

from app.core.errors import AppError
from app.db.models import Job, utcnow
from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.jobs.queue import claim, sweep
from app.jobs.worker import run_job
from app.providers import travel
from app.schemas.collections import today
from app.schemas.travel import TravelInput
from app.services.travel import weather

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_unknown_call_not_retried_and_original_version_preserved(monkeypatch):
    plan, _ = generate(create())
    original = plan["revision"]

    def unknown(*args):
        raise AppError("CALL_RESULT_UNKNOWN", "unknown result")

    monkeypatch.setattr(travel, "fake", unknown)
    plan, job = generate(plan)
    assert job["status"] == "interrupted" and plan["revision"] == original
    with session_factory()() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(ModelCall)
                .where(ModelCall.job_id == UUID(job["id"]))
            )
            == 1
        )
    for _ in range(3):
        assert read(plan)["revision"] == original


def test_dead_worker_swept_without_new_call():
    plan = create()
    client.post(f"{ROOT}/{plan['id']}/generate", json={"expected_version": 1}, headers=headers())
    job_id, token = claim()
    with session_factory().begin() as db:
        job = db.get(Job, job_id)
        job.heartbeat_at = utcnow() - timedelta(minutes=10)
        db.add(ModelCall(job_id=job_id, step="travel", attempt=0, state="sent"))
    sweep()
    run_job(job_id, token)
    job = client.get(f"/api/v1/jobs/{job_id}").json()["data"]
    assert job["status"] == "interrupted"
    assert read(plan)["revision"] is None
    assert claim() is None


def test_concurrent_garment_change_cannot_publish(monkeypatch, wardrobe):  # noqa: F811
    original = travel.fake

    def mutate(context):
        result = original(context)
        gid = UUID(result["days"][0]["garment_ids"][0])
        with session_factory().begin() as db:
            g = db.get(Garment, gid)
            g.version += 1
            g.attributes = {**g.attributes, "availability": "unavailable"}
        return result

    monkeypatch.setattr(travel, "fake", mutate)
    plan, job = generate(create())
    assert job["status"] == "failed" and job["error"]["code"] == "CONSTRAINT_CONFLICT"
    assert plan["revision"] is None


def test_cancelled_request_never_publishes(monkeypatch):
    original = travel.fake

    def cancel(context):
        with session_factory()() as db:
            job = db.scalar(select(Job).where(Job.kind == "travel_generate"))
            client.post(f"/api/v1/jobs/{job.id}/cancel")
        return original(context)

    monkeypatch.setattr(travel, "fake", cancel)
    plan, job = generate(create())
    assert job["status"] == "cancelled" and plan["revision"] is None


def test_weather_uses_exact_forecast_date_and_manual_priority(monkeypatch):
    start = today()
    body = payload(
        3,
        city={
            "id": "101280601",
            "source": "qweather",
            "name": "深圳",
            "adm1": "广东省",
            "latitude": 22.54,
            "longitude": 114.06,
        },
    )
    body["days"][0]["weather"] = {"temperature_c": 0, "condition": "手填"}
    requests = []

    def request(path, params):
        requests.append((path, params))
        return {
            "metadata": {"attributions": ["source"]},
            "days": [
                {
                    "daytime": {
                        "forecastStartTime": f"{start + timedelta(days=1)}T07:00:00+08:00",
                        "condition": {"text": "晴"},
                    },
                    "temperatureMax": {"value": 24, "unit": "°C"},
                    "temperatureMin": {"value": 18, "unit": "°C"},
                }
            ],
        }

    monkeypatch.setattr(weather, "request", request)
    result = weather.forecasts(TravelInput.model_validate(body))
    assert result[str(start)]["source"] == "manual" and result[str(start)]["temperature_c"] == 0
    assert result[str(start + timedelta(days=1))]["source"] == "qweather"
    assert result[str(start + timedelta(days=2))]["source"] == "unknown"
    assert requests[0][1]["days"] == "7" and "/daily/" in requests[0][0]
    body["days"] = [{"date": str(start + timedelta(days=30)), "occasion": "work"}]
    assert (
        weather.forecasts(TravelInput.model_validate(body))[str(start + timedelta(days=30))][
            "source"
        ]
        == "unknown"
    )
    assert len(requests) == 1


def test_unknown_weather_on_failure(monkeypatch):
    def unavailable(*args):
        raise AppError("WEATHER_UNAVAILABLE", "missing")

    monkeypatch.setattr(weather, "request", unavailable)
    body = payload(
        1,
        city={
            "id": "101280601",
            "source": "qweather",
            "name": "深圳",
            "adm1": "广东省",
            "latitude": 22.54,
            "longitude": 114.06,
        },
    )
    assert weather.forecasts(TravelInput.model_validate(body))[str(today())]["source"] == "unknown"


def test_wrong_other_day_rejected_and_empty_wardrobe_no_call(monkeypatch):
    plan, _ = generate(create())
    original = plan["revision"]
    real = travel.fake

    def change_others(context):
        result = real(context)
        result["days"][1]["garment_ids"].reverse()
        return result

    monkeypatch.setattr(travel, "fake", change_others)
    plan, job = generate(plan, adjust_date=str(today()))
    assert job["status"] == "failed" and plan["revision"] == original
    with session_factory().begin() as db:
        for g in db.scalars(select(Garment)):
            g.attributes = {**g.attributes, "availability": "unavailable"}
    plan, job = generate(create())
    assert job["status"] == "failed"
    with session_factory()() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(ModelCall)
                .where(ModelCall.job_id == UUID(job["id"]))
            )
            == 0
        )
