"""Review edits must not create stale category/subtype combinations."""

import pytest
from test_import_details import patch, ready
from test_imports import client, confirm

pytestmark = pytest.mark.integration


def test_category_edit_drops_old_subtype_before_confirmation(clean_db):
    bid, row = ready()
    row = patch(bid, row, {"subtype_name": "T恤"}).json()["data"]
    row = patch(bid, row, {"category": "shoes"}).json()["data"]
    assert row["draft"]["subtype_name"] is None
    assert "subtype_name" in row["touched_fields"]
    result = confirm(bid, [row]).json()["data"]["rows"][0]
    garment = client.get(f"/api/v1/garments/{result['garment_id']}").json()["data"]
    assert garment["category"] == "shoes" and garment["subtype_id"] is None


def test_category_and_explicit_new_subtype_can_be_saved_together(clean_db):
    bid, row = ready()
    row = patch(bid, row, {"category": "shoes", "subtype_name": "休闲鞋"}).json()["data"]
    assert row["draft"]["subtype_name"] == "休闲鞋"
    assert confirm(bid, [row]).json()["data"]["rows"][0]["status"] == "confirmed"
