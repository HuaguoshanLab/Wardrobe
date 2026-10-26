from datetime import timedelta
from unittest.mock import patch

import httpx
import pytest
import respx
from sqlalchemy import delete, select

from app.core.config import Settings
from app.core.errors import AppError
from app.db.models import utcnow
from app.db.profile import CityRecord, WeatherCache
from app.db.session import session_factory
from app.providers import qweather
from app.schemas.weather import City
from app.services.weather import get_weather, search_cities

CITY = City(
    id="101210101",
    name="杭州",
    adm1="浙江省",
    adm2="杭州",
    latitude=30.27,
    longitude=120.15,
    source="qweather",
)
HOST = "https://test.qweatherapi.com"
SETTINGS = Settings(qweather_host="test.qweatherapi.com", qweather_api_key="private-test-key")
CURRENT = {
    "metadata": {"attributions": ["QWeather"]},
    "temperature": {"value": 0, "unit": "°C"},
    "condition": {"text": "雪"},
}


def test_unconfigured_is_never_fake() -> None:
    with patch(
        "app.providers.qweather.get_settings",
        return_value=Settings(qweather_host="", qweather_api_key="", qweather_token=""),
    ):
        with pytest.raises(AppError) as error:
            qweather.cities("杭州")
        assert error.value.code == "WEATHER_NOT_CONFIGURED"


@respx.mock
def test_geo_filters_mainland_and_coordinate_order() -> None:
    route = respx.get(f"{HOST}/geo/v2/city/lookup").mock(
        return_value=httpx.Response(
            200,
            json={
                "code": "200",
                "location": [
                    {
                        "id": "101210101",
                        "name": "杭州",
                        "adm1": "浙江",
                        "adm2": "杭州",
                        "country": "中国",
                        "lat": "30.27",
                        "lon": "120.15",
                    },
                    {
                        "id": "hk",
                        "name": "香港",
                        "adm1": "香港",
                        "adm2": "香港",
                        "country": "中国",
                        "lat": "22",
                        "lon": "114",
                    },
                ],
            },
        )
    )
    with patch("app.providers.qweather.get_settings", return_value=SETTINGS):
        assert qweather.cities("120.15,30.27") == [CITY]
    assert route.calls.last.request.url.params["location"] == "120.15,30.27"
    assert route.calls.last.request.url.params["range"] == "cn"
    assert route.calls.last.request.headers["X-QW-Api-Key"] == "private-test-key"
    assert "private-test-key" not in str(route.calls.last.request.url)


@respx.mock
def test_current_units_optional_fields_and_zero() -> None:
    route = respx.get(f"{HOST}/weather/v1/current/30.27/120.15").mock(
        return_value=httpx.Response(200, json=CURRENT)
    )
    with patch("app.providers.qweather.get_settings", return_value=SETTINGS):
        result = qweather.weather(CITY, "current")
        assert result.temperature_c == 0 and result.feels_like_c is None
        assert result.observed_at is None and result.kind == "current"
        route.mock(
            return_value=httpx.Response(
                200, json={**CURRENT, "temperature": {"value": 32, "unit": "°F"}}
            )
        )
        with pytest.raises(AppError) as error:
            qweather.weather(CITY, "current")
        assert error.value.code == "WEATHER_INVALID_RESPONSE"


@respx.mock
@pytest.mark.parametrize("status,calls", [(401, 1), (429, 1), (503, 2)])
def test_failures_have_bounded_retries_and_no_secrets(status: int, calls: int) -> None:
    route = respx.get(f"{HOST}/weather/v1/current/30.27/120.15").mock(
        return_value=httpx.Response(status)
    )
    with patch("app.providers.qweather.get_settings", return_value=SETTINGS):
        with pytest.raises(AppError) as error:
            qweather.weather(CITY, "current")
    assert route.call_count == calls
    assert "private-test-key" not in error.value.message


@respx.mock
def test_daily_date_not_confused_with_realtime() -> None:
    from zoneinfo import ZoneInfo

    today = utcnow().astimezone(ZoneInfo("Asia/Shanghai")).date()
    data = {
        "metadata": {"attributions": []},
        "days": [
            {
                "daytime": {
                    "forecastStartTime": f"{today}T07:00:00+08:00",
                    "condition": {"text": "晴"},
                },
                "temperatureMax": {"value": 12, "unit": "°C"},
                "temperatureMin": {"value": 0, "unit": "°C"},
            }
        ],
    }
    route = respx.get(f"{HOST}/weather/v1/daily/30.27/120.15").mock(
        return_value=httpx.Response(200, json=data)
    )
    with patch("app.providers.qweather.get_settings", return_value=SETTINGS):
        result = qweather.weather(CITY, "daily")
        assert result.valid_for == today and result.temperature_c is None
        assert result.minimum_c == 0
        data["days"][0]["daytime"]["forecastStartTime"] = "2000-01-01T07:00:00+08:00"
        route.mock(return_value=httpx.Response(200, json=data))
        with pytest.raises(AppError):
            qweather.weather(CITY, "daily")


@pytest.mark.integration
def test_cache_expiry_city_isolation_and_partial_failure(clean_db: None) -> None:
    with session_factory().begin() as db:
        db.execute(delete(WeatherCache))
        db.execute(delete(CityRecord))
    with patch("app.providers.qweather.cities", return_value=[CITY]):
        search_cities("杭州")
    with respx.mock:
        respx.get(f"{HOST}/weather/v1/current/30.27/120.15").mock(
            return_value=httpx.Response(200, json=CURRENT)
        )
        with patch("app.providers.qweather.get_settings", return_value=SETTINGS):
            fresh = qweather.weather(CITY, "current")

    def fetch(city: City, kind: str):
        if kind == "daily":
            raise AppError("WEATHER_UNAVAILABLE", "failed", 503)
        return fresh

    with patch("app.providers.qweather.weather", side_effect=fetch) as provider:
        first = get_weather(CITY.id)
        second = get_weather(CITY.id)
        assert first.current.temperature_c == 0 and second.current.stale is False
        assert provider.call_count == 3  # current reused, failed daily retried separately
        assert second.daily is None and second.errors == ["WEATHER_UNAVAILABLE"]
    with session_factory().begin() as db:
        cached = db.scalars(select(WeatherCache)).one()
        cached.data = {**cached.data, "expires_at": (utcnow() - timedelta(seconds=1)).isoformat()}
        cached.expires_at = utcnow() - timedelta(seconds=1)
        other = CITY.model_copy(update={"id": "other", "name": "宁波", "longitude": 121.55})
        db.add(CityRecord(id="other", data=other.model_dump(mode="json")))
    with patch(
        "app.providers.qweather.weather", side_effect=AppError("WEATHER_UNAVAILABLE", "failed", 503)
    ):
        stale = get_weather(CITY.id)
        assert stale.current.stale is True
        with pytest.raises(AppError) as other_error:
            get_weather("other")
        assert other_error.value.status == 503
    with pytest.raises(AppError):
        get_weather("unverified")
