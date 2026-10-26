from fastapi import APIRouter, Request
from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.errors import AppError, request_id
from app.db.models import SystemState
from app.db.session import session_factory
from app.schemas.common import Capabilities, Envelope, Health

router = APIRouter()


@router.get("/health/live", response_model=Envelope[Health])
def live(request: Request) -> Envelope[Health]:
    return Envelope(data=Health(status="alive"), request_id=request_id(request))


@router.get("/health/ready", response_model=Envelope[Health])
def ready(request: Request) -> Envelope[Health]:
    try:
        with session_factory()() as db:
            revision = db.scalar(text("SELECT version_num FROM alembic_version"))
            checkpoints = db.scalar(text("SELECT to_regclass('checkpoints.checkpoints')"))
            state = db.get(SystemState, 1)
            if revision != "0004_outfits" or checkpoints is None or state is None:
                raise ValueError("initialization incomplete")
    except Exception as exc:
        raise AppError("NOT_READY", "数据库或迁移尚未就绪", 503) from exc
    return Envelope(data=Health(status="ready"), request_id=request_id(request))


@router.get("/capabilities", response_model=Envelope[Capabilities])
def capabilities(request: Request) -> Envelope[Capabilities]:
    with session_factory()() as db:
        epoch = db.scalar(select(SystemState.data_epoch).where(SystemState.id == 1))
        if epoch is None:
            raise AppError("NOT_INITIALIZED", "请先运行初始化迁移", 503)
    mode = get_settings().provider_mode
    return Envelope(
        data=Capabilities(
            provider_mode=mode,
            model="fake"
            if mode == "fake"
            else "configured"
            if mode == "qwen" and get_settings().qwen_configured
            else "unconfigured",
            weather="configured" if get_settings().weather_configured else "unconfigured",
            cutout="local_u2netp" if get_settings().cutout_enabled else "disabled",
            maintenance=False,
            data_epoch=epoch,
        ),
        request_id=request_id(request),
    )
