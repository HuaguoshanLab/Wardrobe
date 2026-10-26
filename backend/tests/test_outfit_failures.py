from datetime import timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from test_outfits import client, current, generate, headers, session
from test_outfits import wardrobe as wardrobe

from app.agent.checkpoints import checkpointer
from app.agent.outfits import build_outfit_graph
from app.agent.outfits import generate as generate_node
from app.core.errors import AppError
from app.db.models import Job, utcnow
from app.db.outfits import ModelCall, OutfitRevision
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.jobs.queue import claim
from app.jobs.worker import run_job
from app.schemas.outfits import ModelOutfits, Proposal
from app.services.outfits.context import prepare_context

pytestmark = pytest.mark.integration


def enqueue(s):
    response = client.post(
        f"/api/v1/outfit-sessions/{s['id']}/generate",
        headers=headers(),
        json={"expected_version": s["version"]},
    )
    assert response.status_code == 202, response.text
    return claim()


def test_invalid_ids_exhaust_one_repair_without_committing(wardrobe):
    s, _ = generate(session())
    original = s["selected_revision_id"]
    job_id, token = enqueue(s)
    invalid = ModelOutfits(message="bad", outfits=[Proposal(garment_ids=[uuid4()], reason="bad")])
    with patch("app.services.outfits.calls.fake_outfits", return_value=invalid) as provider:
        run_job(job_id, token)
        assert provider.call_count == 2
    job = client.get(f"/api/v1/jobs/{job_id}").json()["data"]
    assert job["status"] == "failed" and job["error"]["code"] == "INVALID_MODEL_OUTPUT"
    assert current()["selected_revision_id"] == original


def test_response_unknown_is_not_replayed_and_explicit_retry_is_new_job(wardrobe):
    job_id, token = enqueue(session())
    with patch(
        "app.services.outfits.calls.fake_outfits",
        side_effect=AppError("CALL_RESULT_UNKNOWN", "unknown"),
    ) as provider:
        run_job(job_id, token)
        run_job(job_id, token)
        assert provider.call_count == 1
    assert client.get(f"/api/v1/jobs/{job_id}").json()["data"]["status"] == "interrupted"
    key = headers()
    retry = client.post(f"/api/v1/jobs/{job_id}/retry", headers=key)
    assert retry.status_code == 202, retry.text
    assert (
        client.post(f"/api/v1/jobs/{job_id}/retry", headers=key).json()["data"]
        == retry.json()["data"]
    )
    assert retry.json()["data"]["job_id"] != str(job_id)
    run_job(*claim())
    assert (
        client.get("/api/v1/jobs/" + retry.json()["data"]["job_id"]).json()["data"]["status"]
        == "succeeded"
    )


def test_garment_change_before_commit_rejects_all_results(wardrobe):
    s = session()
    job_id, token = enqueue(s)
    config = {"configurable": {"thread_id": "outfit:" + s["id"]}}
    with checkpointer() as saver:
        build_outfit_graph(saver, pause=True).invoke(
            {"job_id": str(job_id), "lease_token": str(token)}, config
        )
    with session_factory().begin() as db:
        job = db.get(Job, job_id)
        gid = UUID(job.provider_response["output"]["outfits"][0]["garment_ids"][0])
        garment = db.get(Garment, gid)
        garment.version += 1
        garment.attributes = {**garment.attributes, "availability": "unavailable"}
    run_job(job_id, token)
    assert (
        client.get(f"/api/v1/jobs/{job_id}").json()["data"]["error"]["code"]
        == "CONSTRAINT_CONFLICT"
    )
    assert current()["revisions"] == []


def test_unavailable_excluded_preferences_refreshed_and_sse_read_only(wardrobe):
    s = session()
    with session_factory().begin() as db:
        garment = db.get(Garment, wardrobe[0])
        garment.attributes = {**garment.attributes, "availability": "unavailable"}
    pref = client.get("/api/v1/profile/preferences").json()["data"]
    client.patch(
        "/api/v1/profile/preferences",
        headers=headers(),
        json={"expected_version": pref["version"], "preferences": {"style_codes": ["classic"]}},
    )
    s, job = generate(s)
    assert all(str(wardrobe[0]) != i["garment_id"] for r in s["revisions"] for i in r["items"])
    assert s["revisions"][0]["request_snapshot"]["preferences"]["style_codes"] == ["classic"]
    response = client.get(f"/api/v1/jobs/{job['id']}/events")
    assert (
        response.status_code == 200
        and "revision_ids" in response.text
        and "succeeded" in response.text
    )
    response = client.get(f"/api/v1/jobs/{job['id']}/events?after_seq={job['last_seq']}")
    assert response.status_code == 200 and response.text == ""
    before = current()
    client.post(f"/api/v1/jobs/{job['id']}/cancel")
    assert current() == before


def test_deadline_does_not_call_model(wardrobe):
    job_id, token = enqueue(session())
    prepare_context(job_id, token)
    with session_factory().begin() as db:
        job = db.get(Job, job_id)
        context = {
            **job.input_snapshot["context"],
            "deadline": (utcnow() - timedelta(seconds=1)).isoformat(),
        }
        job.input_snapshot = {**job.input_snapshot, "context": context}
    with pytest.raises(AppError) as failure:
        generate_node({"job_id": str(job_id), "lease_token": str(token)})
    assert failure.value.code == "BUDGET_EXCEEDED"
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0


def test_missing_weather_is_actionable_and_does_not_call_model(wardrobe):
    s = client.post("/api/v1/outfit-sessions", headers=headers(), json={}).json()["data"]
    location = client.get("/api/v1/profile/location").json()["data"]
    client.patch(
        "/api/v1/profile/location",
        headers=headers(),
        json={"expected_version": location["version"], "city": None},
    )
    job_id, token = enqueue(s)
    run_job(job_id, token)
    job = client.get(f"/api/v1/jobs/{job_id}").json()["data"]
    assert job["error"]["code"] == "WEATHER_REQUIRED"
    assert current()["requirements"] == s["requirements"]
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0


def test_business_commit_survives_failure_to_save_final_checkpoint(wardrobe):
    s = session()
    job_id, token = enqueue(s)
    config = {"configurable": {"thread_id": "outfit:" + s["id"]}}
    with checkpointer() as saver:
        original_put = saver.put

        def put(*args, **kwargs):
            with session_factory()() as db:
                if db.get(Job, job_id).status == "succeeded":
                    raise RuntimeError("injected checkpoint failure after business commit")
            return original_put(*args, **kwargs)

        with patch.object(saver, "put", side_effect=put):
            with pytest.raises(RuntimeError, match="injected checkpoint"):
                build_outfit_graph(saver).invoke(
                    {"job_id": str(job_id), "lease_token": str(token)}, config
                )
    with session_factory()() as db:
        result = db.get(Job, job_id).result
        calls = db.scalar(select(func.count()).select_from(ModelCall))
        count = db.scalar(select(func.count()).select_from(OutfitRevision))
    with checkpointer() as saver:
        build_outfit_graph(saver).invoke(None, config)
    with session_factory()() as db:
        assert db.get(Job, job_id).result == result
        assert db.scalar(select(func.count()).select_from(ModelCall)) == calls
        assert db.scalar(select(func.count()).select_from(OutfitRevision)) == count


def test_stale_automatic_weather_never_reaches_model(wardrobe):
    from zoneinfo import ZoneInfo

    from test_weather import CITY

    from app.schemas.weather import WeatherReading, WeatherResult
    from app.services.profile import profile

    s = client.post("/api/v1/outfit-sessions", headers=headers(), json={}).json()["data"]
    with session_factory().begin() as db:
        profile(db).city = CITY.model_dump(mode="json")
    reading = WeatherReading(
        kind="current",
        city=CITY,
        fetched_at=utcnow() - timedelta(hours=1),
        valid_for=utcnow().astimezone(ZoneInfo("Asia/Shanghai")).date(),
        expires_at=utcnow() - timedelta(minutes=45),
        temperature_c=0,
        condition="雪",
        stale=True,
        attribution=[],
    )
    job_id, token = enqueue(s)
    with patch(
        "app.services.outfits.context.get_weather",
        return_value=WeatherResult(city=CITY, current=reading),
    ):
        run_job(job_id, token)
    assert (
        client.get(f"/api/v1/jobs/{job_id}").json()["data"]["error"]["code"] == "WEATHER_REQUIRED"
    )
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0
