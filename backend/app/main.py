from collections.abc import Awaitable, Callable
from uuid import uuid4

from fastapi import FastAPI, Request, Response

from app.api import backups, collections, imports, jobs, outfits, profile, system, wardrobe
from app.core.errors import install_error_handlers
from app.core.maintenance_http import MaintenanceBarrier
from app.core.upload_limit import UploadLimit
from app.schemas.common import ErrorEnvelope

app = FastAPI(
    title="Wardrobe API",
    version="0.1.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
    redoc_url=None,
    responses={code: {"model": ErrorEnvelope} for code in [404, 409, 410, 422, 503]},
)
install_error_handlers(app)
app.add_middleware(UploadLimit)
app.add_middleware(MaintenanceBarrier)


@app.middleware("http")
async def identify_request(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    request.state.request_id = uuid4()
    response = await call_next(request)
    response.headers["X-Request-ID"] = str(request.state.request_id)
    return response


app.include_router(system.router, prefix="/api/v1", tags=["system"])
app.include_router(jobs.router, prefix="/api/v1", tags=["diagnostics"])
app.include_router(wardrobe.router, prefix="/api/v1", tags=["wardrobe"])
app.include_router(imports.router, prefix="/api/v1", tags=["imports"])

app.include_router(profile.router, prefix="/api/v1", tags=["profile-weather"])

app.include_router(outfits.router, prefix="/api/v1", tags=["outfits"])

app.include_router(collections.router, prefix="/api/v1", tags=["collections"])

app.include_router(backups.router, prefix="/api/v1", tags=["backup-restore"])
