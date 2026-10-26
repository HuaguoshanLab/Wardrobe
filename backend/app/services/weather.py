from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import insert

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.profile import CityRecord, WeatherCache
from app.db.session import session_factory
from app.providers import qweather
from app.schemas.weather import City, WeatherReading, WeatherResult


def search_cities(query: str) -> list[City]:
    cities = qweather.cities(query)
    with session_factory().begin() as db:
        for city in cities:
            stmt = insert(CityRecord).values(id=city.id, data=city.model_dump(mode="json"))
            db.execute(
                stmt.on_conflict_do_update(index_elements=["id"], set_={"data": stmt.excluded.data})
            )
    return cities


def reading(
    city: City, kind: Literal["current", "daily"]
) -> tuple[WeatherReading | None, str | None]:
    today = utcnow().astimezone(ZoneInfo("Asia/Shanghai")).date()
    key = f"v1:{city.id}:{city.latitude}:{city.longitude}:{kind}:{today}"
    with session_factory()() as db:
        record = db.get(WeatherCache, key)
        cached = WeatherReading.model_validate(record.data) if record else None
    if cached and cached.expires_at > utcnow():
        return cached, None
    try:
        fresh = qweather.weather(city, kind)
    except AppError as exc:
        # Stale readings remain visible for reference, never masquerade as usable weather.
        if cached:
            cached.stale = True
        return cached, exc.code
    with session_factory().begin() as db:
        stmt = insert(WeatherCache).values(
            key=key, data=fresh.model_dump(mode="json"), expires_at=fresh.expires_at
        )
        db.execute(
            stmt.on_conflict_do_update(
                index_elements=["key"],
                set_={
                    "data": stmt.excluded.data,
                    "expires_at": stmt.excluded.expires_at,
                },
                where=WeatherCache.expires_at < fresh.expires_at,
            )
        )
    return fresh, None


def get_weather(city_id: str) -> WeatherResult:
    with session_factory()() as db:
        city_record = db.get(CityRecord, city_id)
        if city_record is None:
            raise AppError("CITY_NOT_FOUND", "请先搜索并选择大陆城市", 404)
        city = City.model_validate(city_record.data)
    current, current_error = reading(city, "current")
    daily, daily_error = reading(city, "daily")
    if current is None and daily is None:
        raise AppError(
            current_error or daily_error or "WEATHER_UNAVAILABLE",
            "没有可用天气，请手动填写温度和天气现象",
            503,
        )
    return WeatherResult(
        city=city,
        current=current,
        daily=daily,
        errors=list(dict.fromkeys(e for e in (current_error, daily_error) if e)),
    )
