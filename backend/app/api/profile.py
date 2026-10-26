from typing import Annotated

from fastapi import APIRouter, Header, Query, Request

from app.core.errors import request_id
from app.schemas.common import Envelope
from app.schemas.profile import (
    ConditionPreview,
    PreferencesPatch,
    PreferencesView,
    Requirements,
)
from app.schemas.weather import MAINLAND_PROVINCES, City, LocationPatch, LocationView, WeatherResult
from app.services import profile, weather

router = APIRouter()
OperationKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]


@router.get("/profile/preferences", response_model=Envelope[PreferencesView])
def preferences(request: Request) -> Envelope[PreferencesView]:
    return Envelope(data=profile.preferences(), request_id=request_id(request))


@router.patch("/profile/preferences", response_model=Envelope[PreferencesView])
def update_preferences(
    request: Request, payload: PreferencesPatch, key: OperationKey
) -> Envelope[PreferencesView]:
    return Envelope(data=profile.update_preferences(payload, key), request_id=request_id(request))


@router.get("/profile/location", response_model=Envelope[LocationView])
def location(request: Request) -> Envelope[LocationView]:
    return Envelope(data=profile.location(), request_id=request_id(request))


@router.patch("/profile/location", response_model=Envelope[LocationView])
def update_location(
    request: Request, payload: LocationPatch, key: OperationKey
) -> Envelope[LocationView]:
    return Envelope(data=profile.update_location(payload, key), request_id=request_id(request))


@router.get("/weather/provinces", response_model=Envelope[list[str]])
def provinces(request: Request) -> Envelope[list[str]]:
    return Envelope(data=list(MAINLAND_PROVINCES), request_id=request_id(request))


@router.get("/weather/cities", response_model=Envelope[list[City]])
def cities(
    request: Request, q: Annotated[str, Query(min_length=1, max_length=80)]
) -> Envelope[list[City]]:
    return Envelope(data=weather.search_cities(q.strip()), request_id=request_id(request))


@router.get("/weather", response_model=Envelope[WeatherResult])
def current_weather(
    request: Request, city_id: Annotated[str, Query(min_length=1, max_length=40)]
) -> Envelope[WeatherResult]:
    return Envelope(data=weather.get_weather(city_id), request_id=request_id(request))


@router.post("/conditions/preview", response_model=Envelope[ConditionPreview])
def preview(request: Request, payload: Requirements) -> Envelope[ConditionPreview]:
    return Envelope(data=profile.preview(payload), request_id=request_id(request))
