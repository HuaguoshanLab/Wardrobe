from typing import Annotated

from fastapi import APIRouter, Query, Request

from app.core.errors import request_id
from app.schemas.common import Envelope
from app.schemas.usage import UsageRange, UsageReport, UsageView
from app.services.usage import usage_report

router = APIRouter()


@router.get("/wardrobe/usage", response_model=Envelope[UsageReport])
def usage(
    request: Request,
    range: UsageRange = "30",
    view: UsageView = "worn",
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> Envelope[UsageReport]:
    return Envelope(data=usage_report(range, view, offset, limit), request_id=request_id(request))
