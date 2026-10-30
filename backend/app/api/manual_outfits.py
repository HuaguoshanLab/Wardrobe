from typing import Annotated

from fastapi import APIRouter, Header, Request

from app.core.errors import request_id
from app.schemas.common import Envelope
from app.schemas.manual_outfits import ManualOutfitInput, ManualOutfitResult
from app.services.outfits.manual import create

router = APIRouter()
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]


@router.post("/manual-outfits", status_code=201)
def save_manual(
    request: Request, payload: ManualOutfitInput, key: Key
) -> Envelope[ManualOutfitResult]:
    return Envelope(data=create(payload, key), request_id=request_id(request))
