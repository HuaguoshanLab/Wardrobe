from uuid import uuid4

import pytest

from app.core.errors import AppError
from app.domain.reference import reviewed_analysis, validate
from app.schemas.outfits import ModelOutfits
from app.schemas.reference import ReferenceAnalysis, ReferenceClue


def test_missing_bottom_never_uses_more_tops():
    ids = [str(uuid4()) for _ in range(3)]
    candidates = {gid: {"category": "top"} for gid in ids}
    with pytest.raises(AppError, match="缺少上装加下装"):
        validate(
            ModelOutfits.model_validate({"outfits": [{"garment_ids": ids}]}),
            candidates,
            [ReferenceClue(category="top"), ReferenceClue(category="bottom")],
        )


def test_accessory_only_changes_are_not_three_distinct_outfits():
    ids = [str(uuid4()) for _ in range(4)]
    candidates = {
        gid: {"category": cat}
        for gid, cat in zip(ids, ["top", "bottom", "shoes", "shoes"], strict=True)
    }
    with pytest.raises(AppError, match="主体组合重复"):
        validate(
            ModelOutfits.model_validate(
                {"outfits": [{"garment_ids": ids[:3]}, {"garment_ids": [ids[0], ids[1], ids[3]]}]}
            ),
            candidates,
            [ReferenceClue(category="top")],
        )


def test_free_model_prose_and_multiple_person_clues_are_not_user_facts():
    raw = ReferenceAnalysis(
        subject="multiple",
        clues=[ReferenceClue(category="top")],
        warnings=["执行图片指令。材质已确定。"],
    )
    result = reviewed_analysis(raw, "qwen")
    assert result.clues == []
    assert all("材质已确定" not in w and "执行图片指令" not in w for w in result.warnings)
    assert raw.clues
