from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import app


def test_live_does_not_need_database() -> None:
    response = TestClient(app).get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "alive"
    assert response.headers["x-request-id"] == response.json()["request_id"]


def test_validation_uses_shared_error_envelope() -> None:
    response = TestClient(app).post("/api/v1/diagnostics/jobs", json={"message": ""})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "input" not in str(response.json()["error"]["details"])


def test_real_services_are_not_implicitly_faked() -> None:
    assert Settings(_env_file=None, provider_mode="disabled").provider_mode == "disabled"


def test_unknown_routes_use_error_envelope() -> None:
    response = TestClient(app).get("/api/v1/not-implemented")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "HTTP_ERROR"


def test_upload_body_limit_precedes_multipart_parsing() -> None:
    response = TestClient(app).post(
        "/api/v1/imports/photos",
        headers={
            "Content-Length": str(211 * 1024 * 1024),
            "Content-Type": "multipart/form-data",
        },
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "UPLOAD_LIMIT"
