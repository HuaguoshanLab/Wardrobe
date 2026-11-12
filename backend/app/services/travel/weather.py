"""Date-specific forecasts. Unknown stays unknown; never substitute current conditions."""

from datetime import timedelta
from zoneinfo import ZoneInfo

from pydantic import JsonValue, ValidationError

from app.core.errors import AppError
from app.db.models import utcnow
from app.providers.qweather import Daily, amount, request
from app.schemas.travel import TravelInput


def forecasts(payload: TravelInput) -> dict[str, JsonValue]:
    now = utcnow()
    today = now.astimezone(ZoneInfo("Asia/Shanghai")).date()
    result: dict[str, JsonValue] = {}
    for day in payload.days:
        result[str(day.date)] = {
            "source": "manual" if day.weather else "unknown",
            "valid_for": str(day.date),
            **(day.weather.model_dump(mode="json") if day.weather else {}),
        }
    city = payload.city
    if city.source != "qweather" or not any(
        not d.weather and today <= d.date < today + timedelta(days=7) for d in payload.days
    ):
        return result
    try:
        raw = Daily.model_validate(
            request(
                f"/weather/v1/daily/{city.latitude}/{city.longitude}", {"days": "7", "lang": "zh"}
            )
        )
        for entry in raw.days:
            day_date = entry.daytime.forecastStartTime.astimezone(ZoneInfo("Asia/Shanghai")).date()
            target = next((d for d in payload.days if d.date == day_date and not d.weather), None)
            if target is None or not today <= day_date < today + timedelta(days=7):
                continue
            low, high = amount(entry.temperatureMin, "°C"), amount(entry.temperatureMax, "°C")
            if low is None or high is None or low > high:
                raise ValueError("invalid temperature range")
            result[str(day_date)] = {
                "source": "qweather",
                "valid_for": str(day_date),
                "fetched_at": now.isoformat(),
                "expires_at": (now + timedelta(hours=1)).isoformat(),
                "minimum_c": low,
                "maximum_c": high,
                "condition": entry.daytime.condition.text,
                "attribution": [a for a in raw.metadata.attributions],
            }
    except (AppError, ValueError, ValidationError):
        # Missing/unavailable forecasts are permitted and explicitly rendered as unknown.
        pass
    return result
