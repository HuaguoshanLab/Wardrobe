from concurrent.futures import ThreadPoolExecutor
from time import monotonic, sleep

import pytest
from sqlalchemy import select, text
from test_inventory import demand, prepare, save
from test_organization import preview, process
from test_outfits import wardrobe  # noqa: F401

from app.db.session import session_factory
from app.db.wardrobe import Garment

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("wardrobe")]


def test_exit_waits_for_existing_garment_writer_then_rejects_old_preview(wardrobe):  # noqa: F811
    prepare(wardrobe)
    save([demand(lower=2, upper=3)])
    p = preview(wardrobe[0])
    with ThreadPoolExecutor(max_workers=1) as pool:
        with session_factory().begin() as writer:
            g = writer.scalar(select(Garment).where(Garment.id == wardrobe[0]).with_for_update())
            result = pool.submit(process, wardrobe[0], p)
            deadline = monotonic() + 5
            waiting = False
            while monotonic() < deadline:
                with session_factory()() as observer:
                    waiting = bool(
                        observer.scalar(
                            text(
                                "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                                "WHERE datname=current_database() AND wait_event_type='Lock' "
                                "AND query LIKE 'LOCK TABLE garments,%')"
                            )
                        )
                    )
                if waiting:
                    break
                sleep(0.02)
            assert waiting and not result.done()
            # A W1-style transaction holding a row lock can finish its write.
            # SHARE ROW EXCLUSIVE would let the exit lock pass, then deadlock here.
            g.version += 1
            g.lifecycle = {**g.lifecycle, "notes": "另一窗口刚刚修改"}
        response = result.result(timeout=5)
    assert response.status_code == 409, response.text
