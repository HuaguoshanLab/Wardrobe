from unittest.mock import patch

import pytest
from test_outfits import client, headers, session
from test_outfits import wardrobe as wardrobe

from app.core.errors import AppError
from app.db.models import Job
from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.jobs.queue import claim
from app.providers.qwen import PROMPT_VERSION
from app.schemas.outfits import OutfitContext
from app.services.outfits.calls import model_call
from app.services.outfits.context import prepare_context

pytestmark = pytest.mark.integration


def test_old_unsent_prompt_is_blocked_but_saved_response_is_reused(wardrobe):
    s = session()
    response = client.post(
        f"/api/v1/outfit-sessions/{s['id']}/generate",
        headers=headers(),
        json={"expected_version": s["version"]},
    )
    assert response.status_code == 202
    job_id, token = claim()
    context = OutfitContext.model_validate(prepare_context(job_id, token))
    with session_factory().begin() as db:
        job = db.get(Job, job_id)
        assert job.input_snapshot["prompt_version"] == PROMPT_VERSION
        job.input_snapshot = {
            **job.input_snapshot,
            "provider_mode": "qwen",
            "prompt_version": "outfits-v1",
        }
    with patch("app.providers.qwen.invoke") as invoke:
        with pytest.raises(AppError) as exc:
            model_call(job_id, token, "outfits", 0, context)
        assert exc.value.code == "PROVIDER_CONFIG_CHANGED"
        invoke.assert_not_called()
    with session_factory().begin() as db:
        assert db.get(ModelCall, (job_id, "outfits", 0)) is None
        db.add(
            ModelCall(
                job_id=job_id,
                step="outfits",
                attempt=0,
                state="received",
                response={"outfits": [], "message": "旧响应"},
            )
        )
    with patch("app.providers.qwen.invoke") as invoke:
        assert model_call(job_id, token, "outfits", 0, context)["message"] == "旧响应"
        invoke.assert_not_called()
