from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from test_outfits import client, generate, session
from test_outfits import wardrobe as wardrobe

from app.db.outfits import ModelCall
from app.db.session import session_factory
from app.domain.outfit_explanations import explain, summary
from app.schemas.outfits import ItemSnapshot, ModelOutfits, Proposal


def item(**attributes):
    return ItemSnapshot(item_id=uuid4(), slot="shoes", source="wardrobe", attributes=attributes)


def test_fact_renderer_does_not_infer_from_name_or_other_item():
    text = explain(
        [
            item(name="宽松白底棉鞋，适合22℃", color_codes=["beige"], occasion_codes=[]),
            item(occasion_codes=["daily"], material="cotton", warmth="warm"),
        ],
        ["color_echo"],
    )
    first, second = text.splitlines()[1:3]
    assert "颜色：米色" in first and "未知：场合" in first
    assert "日常" not in first and "棉" not in first and "22℃" not in text
    assert "场合：日常" in second and "材质：棉" in second and "保暖：保暖" in second
    assert "审美建议（主观尝试" in text and "可尝试" in text
    assert "精确适温" in text


def test_aesthetic_free_text_is_rejected_and_unknown_facts_stay_unknown():
    with pytest.raises(ValidationError):
        Proposal(garment_ids=[uuid4()], aesthetic_codes=["鞋适合日常"])
    text = explain([item()], [])
    assert "未知：颜色、场合、风格、季节、材质、厚薄、保暖" in text
    assert "审美建议" not in text
    assert "不能据此断定" in summary(0, empty_wardrobe=False, clarify=False)


@pytest.mark.integration
def test_model_false_claims_do_not_reach_persisted_results_but_ledger_is_preserved(wardrobe):
    raw = {
        "outfits": [
            {
                "garment_ids": list(map(str, [wardrobe[0], wardrobe[2], wardrobe[4]])),
                "reason": "鞋已标日常，宽松白底，适合22℃",
                "unmet_requirements": ["全部来自本次8件"],
                "aesthetic_codes": ["simple_palette"],
                "suggestions": [{"category": "hat", "description": "羊毛帽足够保暖"}],
            }
        ],
        "message": "鞋已标日常，全部满足",
    }
    with patch(
        "app.services.outfits.calls.fake_outfits", return_value=ModelOutfits.model_validate(raw)
    ):
        saved, job = generate(session())
    revision = saved["revisions"][0]
    text = str(revision) + str(job["result"]) + str(saved["messages"][-1])
    for claim in ["鞋已标日常", "宽松白底", "适合22℃", "全部来自本次8件", "足够保暖", "全部满足"]:
        assert claim not in text
    assert "事实说明" in revision["reason"] and "审美建议（主观尝试" in revision["reason"]
    assert revision["request_snapshot"]["explanation_version"] == "facts-v1"
    assert "部分单品保暖程度未知" in str(job["result"])
    with session_factory()() as db:
        call = db.scalar(select(ModelCall).where(ModelCall.job_id == UUID(job["id"])))
        assert call.response == raw
    assert client.get("/api/v1/outfit-revisions/" + revision["id"]).json()["data"] == revision
