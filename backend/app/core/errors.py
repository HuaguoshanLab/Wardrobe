from uuid import UUID, uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException

from app.schemas.common import ErrorDetail, ErrorEnvelope


class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 409) -> None:
        self.code, self.message, self.status = code, message, status


def request_id(request: Request) -> UUID:
    return UUID(str(getattr(request.state, "request_id", uuid4())))


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError) -> JSONResponse:
        body = ErrorEnvelope(
            request_id=request_id(request), error=ErrorDetail(code=exc.code, message=exc.message)
        )
        return JSONResponse(body.model_dump(mode="json"), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    @app.exception_handler(ValidationError)
    async def validation_error(
        request: Request, exc: RequestValidationError | ValidationError
    ) -> JSONResponse:
        details = [
            {"field": ".".join(map(str, e["loc"])), "reason": e["type"]} for e in exc.errors()
        ]
        body = ErrorEnvelope(
            request_id=request_id(request),
            error=ErrorDetail(code="VALIDATION_ERROR", message="请求参数不合法", details=details),
        )
        return JSONResponse(body.model_dump(mode="json"), status_code=422)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return await app_error(request, AppError("HTTP_ERROR", "请求不可用", exc.status_code))

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Never serialize exception strings: they can contain database credentials.
        return await app_error(request, AppError("INTERNAL_ERROR", "服务暂时不可用", 500))
