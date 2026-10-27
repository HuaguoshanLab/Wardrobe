"""Bounded Fake-provider pause for P6 browser recovery; isolated Compose only."""

import os
import time
from pathlib import Path

from app.core.config import get_settings
from app.jobs.worker import main
from app.services.outfits import calls
from sqlalchemy.engine import make_url

settings = get_settings()
if (
    os.getenv("P6_ISOLATED_REGRESSION") != "1"
    or make_url(settings.database_url).database != "regression_test"
    or settings.provider_mode != "fake"
    or settings.recognition_mode != "fake"
    or settings.qwen_configured
    or settings.weather_configured
    or str(settings.control_root) != "/data/control"
):
    raise RuntimeError("Refusing to run outside the isolated P6 Fake stack")
original = calls.fake_outfits
root = Path("/data/control")


def controlled_fake(context, intent):
    marker = root / "p6-pause-next-outfit"
    if marker.exists():
        marker.unlink()
        release = root / "p6-resume-outfit"
        release.unlink(missing_ok=True)
        (root / "p6-outfit-paused").touch()
        try:
            deadline = time.monotonic() + 60
            while not release.exists():
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        "P6 browser did not release Fake provider within 60 seconds"
                    )
                time.sleep(0.1)
        finally:
            (root / "p6-outfit-paused").unlink(missing_ok=True)
            release.unlink(missing_ok=True)
    return original(context, intent)


calls.fake_outfits = controlled_fake
main()
