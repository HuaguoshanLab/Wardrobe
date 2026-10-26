from uuid import uuid4

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class UploadLimit:
    """Bound multipart bodies before Starlette spools files, including chunked requests."""

    def __init__(self, app: ASGIApp, maximum: int = 210 * 1024 * 1024) -> None:
        self.app, self.maximum = app, maximum

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            length = self.maximum + 1
        if length > self.maximum:
            await JSONResponse(
                {
                    "request_id": str(uuid4()),
                    "error": {
                        "code": "UPLOAD_LIMIT",
                        "message": "上传请求超过 210 MiB",
                        "details": [],
                    },
                },
                status_code=413,
            )(scope, receive, send)
            return
        size = 0

        async def bounded_receive() -> Message:
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            if size > self.maximum:
                raise HTTPException(413, "Upload limit")
            return message

        await self.app(scope, bounded_receive, send)
