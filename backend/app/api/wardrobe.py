from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.core.errors import AppError, request_id
from app.db.session import session_factory
from app.db.wardrobe import Tag
from app.domain.taxonomy import TAXONOMY
from app.media.storage import path_for
from app.schemas.common import Envelope
from app.schemas.wardrobe import (
    AttributePatch,
    GarmentList,
    GarmentView,
    TagInput,
    TagPatch,
    TagView,
)
from app.services.catalog import list_garments
from app.services.tags import delete_tag, rename_tag
from app.services.wardrobe import (
    asset,
    delete_garment,
    find_garment,
    garment_view,
    get_or_create_tag,
    patch_garment,
)

router = APIRouter()


def version_header(value: str) -> int:
    try:
        return int(value.strip('"'))
    except ValueError as exc:
        raise AppError("INVALID_VERSION", "If-Match 必须携带资源版本", 422) from exc


@router.get("/taxonomies")
def taxonomies(request: Request) -> Envelope[dict[str, object]]:
    return Envelope(data={"version": 1, "fields": TAXONOMY}, request_id=request_id(request))


@router.get("/garments", response_model=Envelope[GarmentList])
def garments(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: UUID | None = None,
    q: str = "",
    category: str | None = None,
    season: str | None = None,
    occasion: str | None = None,
    availability: str | None = None,
    tag_id: UUID | None = None,
) -> Envelope[GarmentList]:
    return Envelope(
        data=list_garments(limit, cursor, q, category, season, occasion, availability, tag_id),
        request_id=request_id(request),
    )


@router.get("/garments/{garment_id}", response_model=Envelope[GarmentView])
def garment(request: Request, response: Response, garment_id: UUID) -> Envelope[GarmentView]:
    with session_factory()() as db:
        result = garment_view(db, find_garment(db, garment_id))
        response.headers["ETag"] = f'"{result.version}"'
        return Envelope(data=result, request_id=request_id(request))


@router.patch("/garments/{garment_id}", response_model=Envelope[GarmentView])
def edit(
    request: Request, response: Response, garment_id: UUID, payload: AttributePatch
) -> Envelope[GarmentView]:
    result = patch_garment(garment_id, payload.expected_version, dict(payload.changes))
    response.headers["ETag"] = f'"{result.version}"'
    return Envelope(data=result, request_id=request_id(request))


@router.delete("/garments/{garment_id}", status_code=204)
def remove(garment_id: UUID, if_match: Annotated[str, Header()]) -> Response:
    delete_garment(garment_id, version_header(if_match))
    return Response(status_code=204)


@router.get("/media/{media_id}")
def media(
    media_id: UUID, variant: Literal["original", "cutout", "source"] = "original"
) -> FileResponse:
    with session_factory()() as db:
        item = asset(db, media_id)
        key = (
            item.original_key
            if variant == "source"
            else item.cutout_key
            if variant == "cutout"
            else item.display_key
        )
        if not key or not path_for(key).is_file():
            raise AppError("MEDIA_NOT_READY", "图片尚未生成或文件不可用", 404)
        return FileResponse(
            path_for(key),
            media_type="application/octet-stream" if variant == "source" else "image/png",
            filename=item.original_name if variant == "source" else None,
            headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-cache"},
        )


@router.get("/tags", response_model=Envelope[list[TagView]])
def tags(request: Request) -> Envelope[list[TagView]]:
    with session_factory()() as db:
        values = db.scalars(select(Tag).order_by(Tag.name)).all()
        return Envelope(
            data=[TagView.model_validate(v) for v in values], request_id=request_id(request)
        )


@router.post("/tags", response_model=Envelope[TagView], status_code=201)
def add_tag(request: Request, payload: TagInput) -> Envelope[TagView]:
    with session_factory().begin() as db:
        return Envelope(
            data=TagView.model_validate(get_or_create_tag(db, payload.name)),
            request_id=request_id(request),
        )


@router.patch("/tags/{tag_id}", response_model=Envelope[TagView])
def edit_tag(request: Request, tag_id: UUID, payload: TagPatch) -> Envelope[TagView]:
    return Envelope(data=rename_tag(tag_id, payload), request_id=request_id(request))


@router.delete("/tags/{tag_id}", status_code=204)
def remove_tag(tag_id: UUID, if_match: Annotated[str, Header()]) -> Response:
    delete_tag(tag_id, version_header(if_match))
    return Response(status_code=204)
