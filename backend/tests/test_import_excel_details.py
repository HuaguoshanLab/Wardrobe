"""v2 initial facts and backward-compatible v1 travel through real review/confirm."""

import io
from datetime import datetime
from uuid import uuid4

import pytest
from openpyxl import load_workbook
from test_imports import batch, client, confirm

from app.jobs.queue import claim
from app.jobs.worker import run_job
from app.media.excel import parse_excel, template
from app.media.import_columns import FIELDS


def workbook(values=None, version=2):
    book = load_workbook(io.BytesIO(template()))
    if version == 1:
        book["meta"]["B1"] = 1
        book["garments"].delete_cols(13, 9)
    for name, value in (values or {}).items():
        book["garments"].cell(2, FIELDS.index(name) + 1, value)
    stream = io.BytesIO()
    book.save(stream)
    return stream.getvalue()


def test_v1_v2_template_and_formula_boundaries():
    downloaded = client.get("/api/v1/imports/template")
    assert downloaded.status_code == 200
    assert "wardrobe-template-v2.xlsx" in downloaded.headers["content-disposition"]
    assert load_workbook(io.BytesIO(downloaded.content))["meta"]["B1"].value == 2
    assert parse_excel(workbook(version=1))[0].attributes["category"] == "top"
    assert "condition" not in parse_excel(workbook(version=1))[0].attributes
    row = parse_excel(workbook({"price": "=1+2"}))[0]
    assert any("公式" in e for e in row.errors)


@pytest.mark.integration
def test_excel_initial_facts_reach_lifecycle(clean_db):
    data = workbook(
        {
            "subtype_name": "短袖",
            "condition": "完好",
            "fit": "合身",
            "source": "购买",
            "acquired_on": datetime(2025, 5, 2),
            "price": 19.90,
            "storage": "已收纳",
            "location": "抽屉",
            "notes": "表格已核对",
        }
    )
    accepted = client.post(
        "/api/v1/imports/excel",
        headers={"Idempotency-Key": str(uuid4())},
        files={"file": ("v2.xlsx", data)},
    )
    assert accepted.status_code == 202, accepted.text
    bid = accepted.json()["data"]["import_batch_id"]
    run_job(*claim())
    row = batch(bid)["rows"][0]
    assert row["row_status"] == "ready", row
    assert row["analysis_status"] == "not_requested"
    assert row["draft"]["acquired_on"] == "2025-05-02"
    result = confirm(bid, [row]).json()["data"]["rows"][0]
    garment = client.get(f"/api/v1/garments/{result['garment_id']}").json()["data"]
    assert garment["lifecycle"]["condition"] == "good" and garment["lifecycle"]["fit"] == "fits"
    assert float(garment["lifecycle"]["price"]) == 19.9
    assert garment["lifecycle"]["location"] == "抽屉" and garment["subtype_id"]


@pytest.mark.integration
def test_invalid_excel_detail_can_be_fixed_in_review(clean_db):
    accepted = client.post(
        "/api/v1/imports/excel",
        headers={"Idempotency-Key": str(uuid4())},
        files={"file": ("bad.xlsx", workbook({"price": -1, "fit": "猜测合身"}))},
    )
    bid = accepted.json()["data"]["import_batch_id"]
    run_job(*claim())
    row = batch(bid)["rows"][0]
    assert row["row_status"] == "invalid"
    assert any("金额" in e for e in row["validation_errors"])
    assert any("合身" in e for e in row["validation_errors"])
    updated = client.patch(
        f"/api/v1/imports/{bid}/rows/{row['id']}",
        json={"expected_version": row["version"], "changes": {"price": None, "fit": "unknown"}},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["row_status"] == "ready"
    assert confirm(bid, [updated.json()["data"]]).json()["data"]["rows"][0]["status"] == "confirmed"
