"""Accepted Excel monetary representations must remain readable by the review UI."""

from uuid import uuid4

import pytest
from test_import_excel_details import workbook
from test_imports import batch, client, confirm

from app.jobs.queue import claim
from app.jobs.worker import run_job


@pytest.mark.integration
@pytest.mark.parametrize("value, expected", [("19.9000", "19.90"), ("1e2", "100.00")])
def test_excel_money_is_canonical_through_review_and_confirmation(clean_db, value, expected):
    result = client.post(
        "/api/v1/imports/excel",
        headers={"Idempotency-Key": str(uuid4())},
        files={"file": ("amount.xlsx", workbook({"price": value}))},
    )
    bid = result.json()["data"]["import_batch_id"]
    run_job(*claim())
    row = batch(bid)["rows"][0]
    assert row["row_status"] == "ready"
    assert row["draft"]["price"] == expected
    outcome = confirm(bid, [row]).json()["data"]["rows"][0]
    garment = client.get(f"/api/v1/garments/{outcome['garment_id']}").json()["data"]
    assert garment["lifecycle"]["price"] == expected
