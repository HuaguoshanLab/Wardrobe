import copy
import json
from unittest.mock import patch

import httpx
import respx
from test_qwen import SETTINGS, URL

from app.providers.outfit_evidence import explanation_evidence
from app.providers.qwen import invoke


def payload():
    return {
        "context": {
            "preferences": {"fit": "loose", "style_codes": ["minimal"]},
            "requirements": {"notes": "只用本次8件，适合22℃"},
            "weather": {"source": "manual", "temperature_c": 22},
            "candidates": [
                {
                    "id": "shirt",
                    "name": "碎花针织衬衫",
                    "category": "top",
                    "color_codes": ["blue", "white"],
                    "style_codes": [],
                    "material": None,
                    "thickness": None,
                    "warmth": None,
                }
            ],
        },
        "message": "喜欢宽松",
        "intent": None,
        "correction": "",
    }


@respx.mock
def test_request_separates_wishes_unknowns_colors_and_batch_membership():
    original = payload()
    before = copy.deepcopy(original)
    route = respx.post(URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"outfits":[],"message":"无匹配"}'}}],
            },
        )
    )
    with patch("app.providers.qwen.get_settings", return_value=SETTINGS):
        invoke(original, "outfits", 10)
    sent = json.loads(json.loads(route.calls.last.request.content)["messages"][1]["content"])
    evidence = sent.pop("explanation_evidence")
    assert sent == before == original
    assert evidence["preferences_are"] == "user_wishes_not_garment_facts"
    assert evidence["visual_input"] == "none"
    assert evidence["candidate_scope"] == "all_available_non_demo_wardrobe"
    assert evidence["import_batch_membership"] == "not_provided"
    assert evidence["weather_is"] == "context_not_proof_of_garment_suitability"
    garment = evidence["garments"][0]
    assert set(garment["unknown_attributes"]) == {
        "style_codes",
        "occasion_codes",
        "seasons",
        "material",
        "thickness",
        "warmth",
    }
    assert set(garment["unrecorded_attributes"]) == {
        "fit",
        "color_roles",
        "comfort",
        "temperature_range",
    }
    assert route.call_count == 1


def test_known_attributes_are_not_erased_and_unknowns_are_per_candidate():
    data = payload()
    known = {"id": "coat", "color_codes": ["black"], "warmth": "warm", "style_codes": ["classic"]}
    data["context"]["candidates"].append(known)
    shirt, coat = explanation_evidence(data)["garments"]
    assert "warmth" in shirt["unknown_attributes"]
    assert not {"warmth", "style_codes", "color_codes"} & set(coat["unknown_attributes"])
    assert "temperature_range" in coat["unrecorded_attributes"]
    assert data["context"]["candidates"][1] == known
