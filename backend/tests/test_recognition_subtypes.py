"""Vision may propose a listed subtype, never overwrite human facts or infer fit."""

import json
from uuid import UUID

import pytest
import respx
from sqlalchemy import func, select
from test_imports import client
from test_recognition_calls import prepared, rows
from test_recognition_provider import SETTINGS, URL, picture, response

from app.db.lifecycle import GarmentSubtype
from app.db.session import session_factory
from app.db.wardrobe import ImportRow
from app.jobs.imports import run_step
from app.providers.recognition import recognize
from app.schemas.recognition import RecognitionResult
from app.services.recognition_subtypes import catalog


def suggestion(category="top", subtype="T恤"):
    return RecognitionResult.model_validate(
        {
            "attributes": {"category": category, "subtype_name": subtype},
            "uncertainties": ["袖口疑似开线，请核对"],
        }
    )


@pytest.mark.integration
def test_catalog_does_not_reintroduce_disabled_defaults(clean_db):
    with session_factory().begin() as db:
        db.add(GarmentSubtype(category="top", name="T恤", active=False))
        db.add(GarmentSubtype(category="top", name="自定义上衣", active=True))
    with session_factory()() as db:
        choices = catalog(db)
        assert "T恤" not in choices["top"]
        assert choices["top"][0] == "自定义上衣"


@pytest.mark.integration
def test_vision_catalog_uses_shape_without_changing_human_subtypes(clean_db):
    with session_factory().begin() as db:
        assert "夹克" in catalog(db)["outerwear"]
        db.add(GarmentSubtype(category="outerwear", name="薄外套", active=True))
        db.add(GarmentSubtype(category="outerwear", name="羽绒服", active=True))
        db.add(GarmentSubtype(category="outerwear", name="夹克", active=False))
    with session_factory()() as db:
        choices = catalog(db)
        assert not {"薄外套", "羽绒服", "夹克"} & set(choices["outerwear"])
        assert db.scalar(select(func.count()).select_from(GarmentSubtype)) == 3
        # A category can still be recognized when no safe subtype is available.
        from app.services.recognition_subtypes import validate

        validate(suggestion("outerwear", None), choices)


@pytest.mark.integration
def test_subtype_prefill_is_only_draft_and_existing_names_are_prioritized(clean_db, monkeypatch):
    with session_factory().begin() as db:
        db.add(GarmentSubtype(category="top", name="我的短袖", active=True))
    accepted, jid, token, rid = prepared()

    def provider(_image, _settings, catalog):
        assert catalog["top"][0] == "我的短袖"
        return suggestion(subtype="我的短袖")

    monkeypatch.setattr("app.services.recognition.recognize", provider)
    run_step(jid, token, rid, "analysis")
    row = rows(accepted)[0]
    assert row["draft"]["subtype_name"] == "我的短袖"
    assert row["draft"]["fit"] == "unknown" and row["draft"]["condition"] == "unknown"
    assert row["draft"]["price"] is None and row["draft"]["acquired_on"] is None
    assert row["analysis_notes"] == ["袖口疑似开线，请核对"]
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(GarmentSubtype)) == 1


@pytest.mark.integration
@pytest.mark.parametrize(
    "manual", [{"category": "shoes"}, {"subtype_name": None}, {"subtype_name": "人工分类"}]
)
def test_late_subtype_respects_manual_category_and_explicit_clear(clean_db, monkeypatch, manual):
    accepted, jid, token, rid = prepared()

    def provider(*_):
        row = rows(accepted)[0]
        patched = client.patch(
            f"/api/v1/imports/{accepted['import_batch_id']}/rows/{rid}",
            json={"expected_version": row["version"], "changes": manual},
        )
        assert patched.status_code == 200
        return suggestion()

    monkeypatch.setattr("app.services.recognition.recognize", provider)
    run_step(jid, token, rid, "analysis")
    row = rows(accepted)[0]
    assert row["draft"]["subtype_name"] == manual.get("subtype_name")
    if "category" in manual:
        assert row["draft"]["category"] == "shoes"


@pytest.mark.integration
def test_excel_existing_subtype_and_invalid_ai_pair(clean_db, monkeypatch):
    accepted, jid, token, rid = prepared()
    with session_factory().begin() as db:
        row = db.get(ImportRow, UUID(str(rid)))
        row.draft = {**row.draft, "category": "top", "subtype_name": "表格短袖"}
    monkeypatch.setattr("app.services.recognition.recognize", lambda *_: suggestion())
    run_step(jid, token, rid, "analysis")
    assert rows(accepted)[0]["draft"]["subtype_name"] == "表格短袖"
    accepted, jid, token, rid = prepared()
    monkeypatch.setattr("app.services.recognition.recognize", lambda *_: suggestion("shoes", "T恤"))
    run_step(jid, token, rid, "analysis")
    row = rows(accepted)[0]
    assert row["analysis_status"] == "failed"
    assert row["draft"]["subtype_name"] is None


@respx.mock
def test_request_includes_subtypes_and_restricts_private_facts():
    route = respx.post(URL).mock(
        return_value=response({"attributes": {"category": "top", "subtype_name": "T恤"}})
    )
    result = recognize(picture(), SETTINGS, {"top": ["T恤"]})
    assert result.attributes.subtype_name == "T恤"
    prompt = json.loads(route.calls.last.request.content)["messages"][0]["content"]
    assert "子类候选" in prompt and "不推断实际合身" in prompt
    assert "只在 uncertainties 提醒人工核对" in prompt
    assert "casual 只能放在 style_codes" in prompt
    assert "没有准确候选或无法确定时 subtype_name=null" in prompt
    assert "顺序不代表匹配程度" in prompt
