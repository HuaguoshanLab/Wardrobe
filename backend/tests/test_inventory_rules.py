from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.errors import AppError
from app.domain.inventory import assess, conclusion, estimate
from app.schemas.inventory import DemandSpec, EstimateInput


def row(**values):
    return DemandSpec(id=uuid4(), name="通勤", category="top", **values)


@pytest.mark.parametrize(
    "lower,upper,k,u,expected",
    [
        (None, None, 10, 0, ("unset", None)),
        (0, 0, 0, 2, ("enough", 0)),
        (0, 0, 1, 0, ("excess", 1)),
        (3, 5, 2, 2, ("review", None)),
        (3, 5, 2, 0, ("shortage", 1)),
        (6, 8, 10, 0, ("excess", 2)),
        (3, 5, 3, 9, ("enough", 0)),
    ],
)
def test_conclusions(lower, upper, k, u, expected):
    assert conclusion(lower, upper, k, u) == expected


@pytest.mark.parametrize(
    "values",
    [
        {"lower": 1},
        {"lower": 2, "upper": 1},
        {"lower": -1, "upper": 3},
        {"lower": True, "upper": 2},
        {"lower": 1.5, "upper": 2},
        {"name": "   "},
    ],
)
def test_invalid_targets(values):
    with pytest.raises(ValidationError):
        DemandSpec.model_validate({"id": uuid4(), "name": "上装", "category": "top", **values})


def test_unknowns_and_known_mismatch_precedence():
    rule = row(occasion_codes=["work", "daily"])
    base = {"category": "top", "seasons": ["spring"], "occasion_codes": ["daily", "work"]}
    good = {"condition": "good", "fit": "fits"}
    assert assess(rule, "spring", base, good, None).bucket == "confirmed"
    assert assess(rule, "spring", base, {}, None).bucket == "pending"
    assert assess(rule, "spring", {**base, "seasons": []}, good, None).bucket == "pending"
    assert assess(rule, "summer", {**base, "occasion_codes": []}, {}, None).bucket == "excluded"
    bad = assess(rule, "spring", {**base, "seasons": []}, {**good, "fit": "unfit"}, None)
    assert bad.bucket == "excluded" and bad.needs_attention


def test_washing_storage_and_pending_decision_do_not_reduce_long_term_count():
    attrs = {"category": "top", "seasons": ["summer", "autumn"], "availability": "unavailable"}
    profile = {
        "condition": "worn",
        "fit": "not_applicable",
        "storage": "stored",
        "unavailable_reason": "washing",
        "decision": "pending",
    }
    assert assess(row(), "summer", attrs, profile, None).bucket == "confirmed"
    assert assess(row(), "autumn", attrs, profile, None).bucket == "confirmed"
    assert assess(row(), "autumn", attrs, profile, None, owned=False).bucket == "excluded"
    assert assess(row(), "autumn", attrs, profile, None, demo=True).bucket == "excluded"


def test_rotation_estimate_is_explainable_and_rejects_unsuitable_categories():
    values = dict(
        category="top", weekly_days=7, laundry_days=3, drying_days=1, repeat_wears=1, spare=1
    )
    assert estimate(EstimateInput(**values)).lower == 5
    assert estimate(EstimateInput(**{**values, "weekly_days": 3, "repeat_wears": 2})).lower == 2
    for overrides in [{"category": "outerwear"}, {"occasion_codes": ["formal"]}]:
        with pytest.raises(AppError):
            estimate(EstimateInput(**{**values, **overrides}))
    with pytest.raises(ValidationError):
        EstimateInput(**{**values, "repeat_wears": 0})
