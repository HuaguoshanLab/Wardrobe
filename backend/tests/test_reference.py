from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from test_outfits import client, current, headers, wardrobe  # noqa: F401

from app.db.models import Job
from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.db.wardrobe import Garment
from app.jobs.queue import claim
from app.jobs.worker import run_job
from app.media.images import demo_image

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]
ROOT = "/api/v1/references"


def create(key=None):
    response = client.post(
        ROOT, files={"file": ("sample.png", demo_image(), "image/png")}, headers=key or headers()
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def read(row):
    return client.get(f"{ROOT}/{row['id']}").json()["data"]


def run(row, action, process=True):
    response = client.post(
        f"{ROOT}/{row['id']}/{action}", json={"expected_version": row["version"]}, headers=headers()
    )
    assert response.status_code == 202, response.text
    if process:
        item = claim()
        assert item
        run_job(*item)
    job = client.get("/api/v1/jobs/" + response.json()["data"]["job_id"]).json()["data"]
    return read(row), job


def confirmed():
    row, job = run(create(), "analyze")
    assert job["status"] == "succeeded", job
    response = client.patch(
        f"{ROOT}/{row['id']}",
        json={"expected_version": row["version"], "clues": row["clues"]},
        headers=headers(),
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_upload_analyze_confirm_generate_snapshot_and_delete(wardrobe):  # noqa: F811
    key = headers()
    row = create(key)
    assert create(key) == row
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(Garment)) == len(wardrobe)
        assert db.scalar(select(func.count()).select_from(Job)) == 0
    assert client.get(row["image_url"]).status_code == 200
    row, job = run(row, "analyze")
    assert job["status"] == "succeeded" and not row["confirmed"]
    assert (
        client.post(
            f"{ROOT}/{row['id']}/generate",
            json={"expected_version": row["version"]},
            headers=headers(),
        ).status_code
        == 422
    )
    row = client.patch(
        f"{ROOT}/{row['id']}",
        json={"expected_version": row["version"], "clues": row["clues"]},
        headers=headers(),
    ).json()["data"]
    row, job = run(row, "generate")
    assert job["status"] == "succeeded", job
    assert current() is None
    revision = client.get("/api/v1/outfit-revisions/" + row["revision_ids"][0]).json()["data"]
    assert "未知" in revision["unmet_requirements"][0]
    with session_factory().begin() as db:
        garment = db.get(Garment, UUID(revision["items"][0]["garment_id"]))
        garment.deleted_at = garment.created_at
        garment.version += 1
    response = client.request(
        "DELETE",
        f"{ROOT}/{row['id']}",
        headers=headers(),
        json={"expected_version": row["version"]},
    )
    assert response.status_code == 200
    assert client.get(row["image_url"]).status_code == 404
    assert client.get("/api/v1/outfit-revisions/" + revision["id"]).json()["data"] == revision
    assert client.get(revision["items"][0]["image_url"]).status_code == 200
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 2


def test_idempotency_versions_busy_and_no_read_calls():
    row = confirmed()
    key = headers()
    body = {"expected_version": row["version"]}
    path = f"{ROOT}/{row['id']}/generate"
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda _: client.post(path, json=body, headers=key), range(2)))
    assert replies[0].json()["data"] == replies[1].json()["data"]
    row = read(row)
    assert (
        client.patch(
            f"{ROOT}/{row['id']}",
            json={"expected_version": row["version"], "clues": []},
            headers=headers(),
        ).status_code
        == 409
    )
    for _ in range(3):
        read(row)
        client.get(ROOT)
        client.get(row["image_url"])
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 1
    assert client.post(path, json={**body, "expected_version": 1}, headers=key).status_code == 409


@pytest.mark.parametrize(
    "result",
    [
        {"outfits": [{"garment_ids": [str(uuid4())]}]},
        {"outfits": [{"garment_ids": []}]},
        {"outfits": "bad"},
    ],
)
def test_invalid_model_budget_and_previous_kept(monkeypatch, result):
    from app.providers import reference

    row, job = run(confirmed(), "generate")
    previous = row["revision_ids"]
    monkeypatch.setattr(reference, "fake", lambda *_: result)
    row, job = run(row, "generate")
    assert job["status"] == "failed" and row["revision_ids"] == previous
    with session_factory()() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(ModelCall)
                .where(ModelCall.job_id == UUID(job["id"]))
            )
            == 2
        )


def test_candidate_changes_cancel_and_no_match(monkeypatch, wardrobe):  # noqa: F811
    row = confirmed()
    row, queued = run(row, "generate", False)
    with session_factory().begin() as db:
        for garment in db.scalars(select(Garment)):
            garment.version += 1
    item = claim()
    run_job(*item)
    job = client.get("/api/v1/jobs/" + queued["id"]).json()["data"]
    assert job["error"]["code"] == "CONSTRAINT_CONFLICT"
    row = read(row)
    row, queued = run(row, "generate", False)
    client.post("/api/v1/jobs/" + queued["id"] + "/cancel")
    assert claim() is None
    row = read(row)
    from app.providers import reference

    monkeypatch.setattr(reference, "fake", lambda *_: {"outfits": []})
    row, job = run(row, "generate")
    assert job["status"] == "succeeded" and job["result"]["no_match"] and not row["revision_ids"]


@pytest.mark.parametrize("subject", ["multiple", "unclear"])
def test_ambiguous_subject_never_selects_clothes(monkeypatch, subject):
    from app.providers import reference

    monkeypatch.setattr(
        reference,
        "fake",
        lambda *_: {"subject": subject, "clues": [{"category": "top"}], "warnings": []},
    )
    row, job = run(create(), "analyze")
    assert job["status"] == "succeeded" and row["clues"] == [] and not row["confirmed"]


def test_invalid_upload_analysis_failure_and_unknown_call(monkeypatch):
    from app.providers import reference

    assert (
        client.post(ROOT, files={"file": ("x.jpg", b"not image")}, headers=headers()).status_code
        == 422
    )
    row, queued = run(create(), "analyze", False)
    item = claim()
    with session_factory().begin() as db:
        db.add(ModelCall(job_id=item[0], step="reference_analyze", attempt=0, state="sent"))
    monkeypatch.setattr(reference, "fake", lambda *_: pytest.fail("must not resend"))
    run_job(*item)
    job = client.get("/api/v1/jobs/" + queued["id"]).json()["data"]
    assert job["status"] == "interrupted" and job["error"]["code"] == "CALL_RESULT_UNKNOWN"
    monkeypatch.setattr(
        reference, "fake", lambda *_: {"subject": "single", "clues": [{"category": "INSTRUCTION"}]}
    )
    row, job = run(read(row), "analyze")
    assert job["status"] == "failed" and row["analysis"] is None


def test_deadline_expires_before_call():
    from datetime import timedelta

    from app.db.models import utcnow

    row, queued = run(create(), "analyze", False)
    with session_factory().begin() as db:
        job = db.get(Job, UUID(queued["id"]))
        job.input_snapshot = {
            **job.input_snapshot,
            "deadline": (utcnow() - timedelta(seconds=1)).isoformat(),
        }
    item = claim()
    run_job(*item)
    job = client.get("/api/v1/jobs/" + queued["id"]).json()["data"]
    assert job["status"] == "failed" and job["error"]["code"] == "BUDGET_EXCEEDED"
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(ModelCall)) == 0
