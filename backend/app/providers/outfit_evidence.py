"""Describe the limits of recorded attributes, without inferring new garment facts."""

from pydantic import JsonValue


def explanation_evidence(payload: dict[str, JsonValue]) -> dict[str, JsonValue]:
    context = payload.get("context")
    context = context if isinstance(context, dict) else {}
    candidates = context.get("candidates")
    candidates = candidates if isinstance(candidates, list) else []
    garments: list[JsonValue] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        unknown: list[JsonValue] = [
            field
            for field in (
                "color_codes",
                "seasons",
                "occasion_codes",
                "style_codes",
                "material",
                "thickness",
                "warmth",
            )
            if not candidate.get(field)
        ]
        garments.append(
            {
                "garment_id": candidate["id"],
                "unknown_attributes": unknown,
                # These are not collected by the current garment schema.
                "unrecorded_attributes": ["fit", "color_roles", "comfort", "temperature_range"],
            }
        )
    return {
        "candidate_scope": "all_available_non_demo_wardrobe",
        "import_batch_membership": "not_provided",
        "visual_input": "none",
        "preferences_are": "user_wishes_not_garment_facts",
        "weather_is": "context_not_proof_of_garment_suitability",
        "garments": garments,
    }
