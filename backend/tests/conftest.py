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
                "TRUNCATE condition_templates, seasonal_sessions, supply_plans, "
                "organization_decisions, "
                "inventory_demands, "
                "inventory_plans, garment_subtypes, "
                "job_events, jobs, import_rows, import_batches, garments, "
                "tags, media_assets, operation_receipts CASCADE"
            )
        )
    yield


@pytest.fixture
def telemetry(monkeypatch):
    from uuid import uuid4

    from langfuse import Langfuse
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    from app.observability import runtime

    exporter = InMemorySpanExporter()
    sdk = Langfuse(
        public_key="pk-lf-test-" + uuid4().hex,
        secret_key="test-only",
        base_url="http://localhost:1",
        environment="test",
        tracer_provider=TracerProvider(shutdown_on_exit=False),
        span_exporter=exporter,
        flush_at=1,
    )
    monkeypatch.setattr(runtime, "client", lambda: sdk)
    yield sdk, exporter
    sdk.shutdown()
