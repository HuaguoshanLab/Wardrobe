from sqlalchemy import select

from app.db.models import SystemState, utcnow
from app.db.session import session_factory
from app.db.wardrobe import Garment, MediaAsset
from app.media.images import demo_image, normalize
from app.media.storage import store_bytes
from app.schemas.wardrobe import Attributes


def seed_demo() -> None:
    with session_factory().begin() as db:
        state = db.scalar(select(SystemState).where(SystemState.id == 1).with_for_update())
        assert state
        if state.demo_seeded_at is not None:
            return
        data = demo_image()
        original, sha = store_bytes(data)
        display, _ = store_bytes(normalize(data)[0], "display")
        media = MediaAsset(
            owner_id=state.owner_id,
            original_key=original,
            original_name="demo.png",
            sha256=sha,
            display_key=display,
            width=480,
            height=480,
        )
        db.add(media)
        db.flush()
        attrs = Attributes(
            category="top",
            name="示例 · 绿色上装",
            color_codes=["green"],
            seasons=["spring", "autumn"],
        )
        db.add(
            Garment(
                owner_id=state.owner_id,
                image_asset_id=media.id,
                attributes=attrs.model_dump(mode="json"),
                is_demo=True,
            )
        )
        state.demo_seeded_at = utcnow()
