import os
from collections.abc import Iterator

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.db.session import get_engine
from app.initialize import main


@pytest.fixture(scope="session")
def database() -> None:
    if os.getenv("WARDROBE_TEST_DATABASE") != "1":
        pytest.skip("Use the dedicated Compose test service for PostgreSQL integration")
    url = make_url(get_settings().database_url)
    if not url.database or not url.database.endswith("_test"):
        pytest.fail("Refusing to initialize/clean a database without the _test suffix")
    main()
    main()  # Initialization must be repeatable, including checkpoint setup.


@pytest.fixture
def clean_db(database: None) -> Iterator[None]:
    with get_engine().begin() as connection:
        connection.execute(
            text(
                "TRUNCATE job_events, jobs, import_rows, import_batches, garments, "
                "tags, media_assets, operation_receipts CASCADE"
            )
        )
    yield
