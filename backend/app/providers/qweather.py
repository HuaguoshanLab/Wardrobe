"""QWeather GeoAPI + Weather v1. Credentials never enter URLs or public errors."""

from datetime import timedelta
from typing import Literal
from zoneinfo import ZoneInfo

import httpx
from pydantic import AwareDatetime, BaseModel, Field, ValidationError

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import utcnow
from app.schemas.weather import MAINLAND_PROVINCES, City, WeatherReading


class Quantity(BaseModel):
    value: float = Field(allow_inf_nan=False)
    unit: str


class Condition(BaseModel):
    text: str = Field(min_length=1, max_length=100)


class Metadata(BaseModel):
    attributions: list[str] = []


class Precipitation(BaseModel):
    amount: Quantity | None = None


class Current(BaseModel):
    metadata: Metadata
    temperature: Quantity
    condition: Condition
    feelsLike: Quantity | None = None
    precipitation: Precipitation | None = None


class Daytime(BaseModel):
    forecastStartTime: AwareDatetime
    condition: Condition


class Day(BaseModel):
    daytime: Daytime
    temperatureMax: Quantity
    temperatureMin: Quantity


class Daily(BaseModel):
    metadata: Metadata
    days: list[Day] = Field(min_length=1)


class GeoCity(BaseModel):
    id: str
    name: str
    adm1: str
    adm2: str
    country: str
    lat: float
    lon: float


class GeoResult(BaseModel):
    code: str
    location: list[GeoCity] = []


def request(path: str, params: dict[str, str]) -> object:
    settings = get_settings()
    if not settings.weather_configured:
        raise AppError("WEATHER_NOT_CONFIGURED", "和风天气未配置，请手动填写城市和天气", 503)
    token = settings.qweather_token.get_secret_value()
    headers = (
        {"Authorization": f"Bearer {token}"}
        if token
        else {"X-QW-Api-Key": settings.qweather_api_key.get_secret_value()}
    )
    try:
        with httpx.Client(timeout=5, follow_redirects=False) as client:
            # At most two read attempts, only transient failures are retried.
            for attempt in range(2):
                try:
                    response = client.get(
                        f"https://{settings.qweather_host}{path}", params=params, headers=headers
                    )
                except httpx.TransportError:
                    if attempt == 0:
                        continue
                    raise
                if response.status_code >= 500 and attempt == 0:
                    continue
                response.raise_for_status()
                return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise AppError("WEATHER_UNAVAILABLE", "和风天气请求失败，可重试或手动填写", 503) from exc
    raise AppError("WEATHER_UNAVAILABLE", "和风天气不可用", 503)


def cities(query: str) -> list[City]:
    try:
        data = GeoResult.model_validate(
            request(
                "/geo/v2/city/lookup",
                {
                    "location": query,
                    "range": "cn",
                    "number": "20",
                    "lang": "zh",
                },
            )
        )
        if data.code == "404":
            return []
        if data.code != "200":
            raise ValueError("upstream error")
        result = []
        for item in data.location:
            # GeoAPI administrative labels can omit the province suffix.
            province = next(
                (
                    p
                    for p in MAINLAND_PROVINCES
                    if item.adm1 and (p == item.adm1 or p.startswith(item.adm1))
                ),
                None,
            )
            if item.country not in ("中国", "China") or province is None:
                continue
            result.append(
                City(
                    id=item.id,
                    name=item.name,
                    adm1=province,
                    adm2=item.adm2,
                    latitude=item.lat,
                    longitude=item.lon,
                    source="qweather",
                )
            )
        return result
    except (ValidationError, ValueError) as exc:
        raise AppError(
            "WEATHER_INVALID_RESPONSE", "城市服务返回了无效数据，请手动填写", 503
        ) from exc


def amount(value: Quantity | None, unit: str) -> float | None:
    if value is None:
        return None
    if value.unit != unit:
        raise ValueError("unexpected unit")
    return value.value


def weather(city: City, kind: Literal["current", "daily"]) -> WeatherReading:
    now = utcnow()
    today = now.astimezone(ZoneInfo("Asia/Shanghai")).date()
    path = f"/weather/v1/{kind}/{city.latitude}/{city.longitude}"
    try:
        raw = request(path, {"lang": "zh", **({"days": "2"} if kind == "daily" else {})})
        if kind == "current":
            current = Current.model_validate(raw)
            return WeatherReading(
                kind=kind,
                city=city,
                fetched_at=now,
                valid_for=today,
                expires_at=now + timedelta(minutes=15),
                temperature_c=amount(current.temperature, "°C"),
                feels_like_c=amount(current.feelsLike, "°C"),
                condition=current.condition.text,
                precipitation_mm=amount(current.precipitation.amount, "mm")
                if current.precipitation
                else None,
                attribution=current.metadata.attributions,
            )
        daily = Daily.model_validate(raw)
        day = next(
            (
                d
                for d in daily.days
                if d.daytime.forecastStartTime.astimezone(ZoneInfo("Asia/Shanghai")).date() == today
            ),
            None,
        )
        if day is None:
            raise ValueError("no forecast for today")
        minimum = amount(day.temperatureMin, "°C")
        maximum = amount(day.temperatureMax, "°C")
        if minimum is None or maximum is None or minimum > maximum:
            raise ValueError("invalid temperature range")
        return WeatherReading(
            kind=kind,
            city=city,
            fetched_at=now,
            valid_for=today,
            expires_at=now + timedelta(minutes=60),
            minimum_c=minimum,
            maximum_c=maximum,
            condition=day.daytime.condition.text,
            attribution=daily.metadata.attributions,
        )
    except (ValidationError, ValueError) as exc:
        raise AppError(
            "WEATHER_INVALID_RESPONSE", "天气数据不完整或单位错误，请手动填写", 503
        ) from exc
