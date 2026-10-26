from uuid import uuid4

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.errors import AppError
from app.core.maintenance import shared


class MaintenanceBarrier:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        # These endpoints never write the business DB. SSE must not hold a lifetime lock.
        exempt = path.startswith(("/api/v1/backups", "/api/v1/restores")) or (
            scope.get("method") == "GET"
            and (
                path.startswith("/api/v1/jobs/")
                or path
                in {
                    "/api/v1/capabilities",
                    "/api/v1/health/live",
                    "/api/v1/health/ready",
                }
            )
        )
        if scope["type"] != "http" or exempt:
            await self.app(scope, receive, send)
            return
        guard = shared()
        try:
            guard.__enter__()
        except AppError as exc:
            await JSONResponse(
                {
                    "request_id": str(uuid4()),
                    "error": {
                        "code": exc.code,
                        "message": exc.message,
                        "details": [],
                    },
                },
                status_code=503,
            )(scope, receive, send)
            return
        try:
            await self.app(scope, receive, send)
        finally:
            guard.__exit__(None, None, None)
