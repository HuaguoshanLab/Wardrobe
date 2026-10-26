from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request

from app.core.errors import request_id
from app.schemas.collections import (
    Deleted,
    FavoriteCreate,
    FavoriteList,
    FavoritePatch,
    FavoriteView,
    HistoryList,
    WearCreate,
    WearList,
    WearPatch,
    WearView,
)
from app.schemas.common import Envelope
from app.services.collections import history, records

router = APIRouter()
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]
Version = Annotated[int, Header(alias="If-Match", ge=1)]
Limit = Annotated[int, Query(ge=1, le=100)]


@router.get("/outfit-revisions")
def list_history(
    request: Request, limit: Limit = 20, cursor: UUID | None = None
) -> Envelope[HistoryList]:
    return Envelope(data=history.history(limit, cursor), request_id=request_id(request))


@router.delete("/outfit-revisions/{revision_id}")
def hide(request: Request, revision_id: UUID, version: Version, key: Key) -> Envelope[Deleted]:
    return Envelope(data=history.hide(revision_id, version, key), request_id=request_id(request))


@router.get("/favorites")
def list_favorites(
    request: Request, limit: Limit = 20, cursor: UUID | None = None
) -> Envelope[FavoriteList]:
    return Envelope(data=records.favorites(limit, cursor), request_id=request_id(request))


@router.post("/favorites", status_code=201)
def favorite(request: Request, payload: FavoriteCreate, key: Key) -> Envelope[FavoriteView]:
    return Envelope(
        data=FavoriteView.model_validate(records.create(payload, key)),
        request_id=request_id(request),
    )


@router.patch("/favorites/{record_id}")
def rename(
    request: Request, record_id: UUID, payload: FavoritePatch, key: Key
) -> Envelope[FavoriteView]:
    return Envelope(
        data=FavoriteView.model_validate(
            records.change(record_id, payload, payload.expected_version, key, True)
        ),
        request_id=request_id(request),
    )


@router.delete("/favorites/{record_id}")
def unfavorite(request: Request, record_id: UUID, version: Version, key: Key) -> Envelope[Deleted]:
    return Envelope(
        data=Deleted.model_validate(records.change(record_id, None, version, key, True)),
        request_id=request_id(request),
    )


@router.get("/wear-records")
def list_wears(
    request: Request,
    limit: Limit = 20,
    cursor: UUID | None = None,
    start: date | None = None,
    end: date | None = None,
) -> Envelope[WearList]:
    return Envelope(data=records.wears(limit, cursor, start, end), request_id=request_id(request))


@router.post("/wear-records", status_code=201)
def wear(request: Request, payload: WearCreate, key: Key) -> Envelope[WearView]:
    return Envelope(
        data=WearView.model_validate(records.create(payload, key)), request_id=request_id(request)
    )


@router.patch("/wear-records/{record_id}")
def edit_wear(
    request: Request, record_id: UUID, payload: WearPatch, key: Key
) -> Envelope[WearView]:
    return Envelope(
        data=WearView.model_validate(
            records.change(record_id, payload, payload.expected_version, key, False)
        ),
        request_id=request_id(request),
    )


@router.delete("/wear-records/{record_id}")
def delete_wear(request: Request, record_id: UUID, version: Version, key: Key) -> Envelope[Deleted]:
    return Envelope(
        data=Deleted.model_validate(records.change(record_id, None, version, key, False)),
        request_id=request_id(request),
    )
