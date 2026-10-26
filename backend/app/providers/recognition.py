from pydantic import JsonValue

from app.core.config import get_settings
from app.core.errors import AppError
from app.schemas.wardrobe import Attributes


def recognize(display: bytes) -> tuple[dict[str, JsonValue], str]:
    """P2 deterministic fixture; production vision adapter is deliberately not implicit."""
    if get_settings().provider_mode != "fake":
        raise AppError("PROVIDER_NOT_CONFIGURED", "识别服务未配置，请手动填写品类", 503)
    result = Attributes(category="top")
    return result.model_dump(mode="json", exclude_unset=True), "fake"
