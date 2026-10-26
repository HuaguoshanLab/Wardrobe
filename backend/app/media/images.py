import io
import warnings
from functools import lru_cache
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rembg.sessions.base import BaseSession

from PIL import Image, ImageDraw, ImageOps
from pillow_heif import register_heif_opener

from app.core.errors import AppError

register_heif_opener(thumbnails=False)
Image.MAX_IMAGE_PIXELS = 64_000_000


def normalize(data: bytes) -> tuple[bytes, int, int]:
    if len(data) > 20 * 1024 * 1024:
        raise AppError("IMAGE_TOO_LARGE", "单张图片不得超过 20 MiB", 413)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP", "HEIF", "HEIC"}:
                    raise ValueError("unsupported format")
                if getattr(image, "n_frames", 1) != 1 or image.width * image.height > 64_000_000:
                    raise ValueError("multi-frame or pixel limit")
                image.load()
                result = ImageOps.exif_transpose(image).convert("RGBA")
                result.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                # A fresh image strips EXIF, location, ICC and textual metadata.
                clean = Image.new("RGBA", result.size)
                clean.paste(result)
                output = io.BytesIO()
                clean.save(output, format="PNG")
                return output.getvalue(), clean.width, clean.height
    except AppError:
        raise
    except Exception as exc:
        raise AppError("INVALID_IMAGE", "图片损坏、格式不支持、多帧或超过 64 MP", 422) from exc


@lru_cache(maxsize=1)
def cutout_session() -> "BaseSession":
    from rembg import new_session

    return new_session("u2netp", providers=["CPUExecutionProvider"])


def cutout(data: bytes) -> bytes:
    from rembg import remove

    value = remove(data, session=cutout_session())
    if not isinstance(value, bytes):
        raise AppError("CUTOUT_FAILED", "去背景未返回有效图片", 422)
    with Image.open(io.BytesIO(value)) as image:
        alpha = image.convert("RGBA").getchannel("A")
        if alpha.getextrema()[1] == 0:
            raise AppError("CUTOUT_EMPTY", "未检测到前景，请使用原图", 422)
    return value


def demo_image() -> bytes:
    image = Image.new("RGB", (480, 480), "#e9eadf")
    draw = ImageDraw.Draw(image)
    draw.polygon(
        [
            (160, 95),
            (205, 115),
            (275, 115),
            (320, 95),
            (405, 165),
            (350, 225),
            (315, 195),
            (315, 385),
            (165, 385),
            (165, 195),
            (130, 225),
            (75, 165),
        ],
        fill="#71846d",
        outline="#53654f",
        width=4,
    )
    draw.arc((205, 82, 275, 145), 0, 180, fill="#53654f", width=5)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
