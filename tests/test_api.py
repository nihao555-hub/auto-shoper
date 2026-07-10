from collections.abc import AsyncIterator

from fastapi.testclient import TestClient

from backend.app.clients.alibaba import AlibabaClient
from backend.app.dependencies import get_alibaba_client
from backend.app.main import app


class FakeAlibabaClient:
    async def call(
        self,
        operation: str,
        parameters: dict[str, object] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
    ) -> dict[str, object]:
        return {"success": True, "operation": operation, "parameters": parameters or {}}


async def fake_alibaba_client() -> AsyncIterator[AlibabaClient]:
    yield FakeAlibabaClient()  # type: ignore[misc]


def test_health_and_capabilities() -> None:
    client = TestClient(app)
    assert client.get("/health").json() == {"status": "ok"}
    capabilities = client.get("/api/v1/capabilities").json()
    assert capabilities["modules"]["sales_expert"] is False


def test_publish_requires_explicit_confirmation() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/alibaba/products/publish",
            json={"category_id": "123", "schema_data": {}, "confirmed_by_user": False},
        )
        assert response.status_code == 409
        confirmed = client.post(
            "/api/v1/alibaba/products/publish",
            json={"category_id": "123", "schema_data": {}, "confirmed_by_user": True},
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["operation"] == "/icbu/product/schema/add"
    finally:
        app.dependency_overrides.clear()


def test_operations_catalog_contains_core_publish_flow() -> None:
    client = TestClient(app)
    operations = {item["key"] for item in client.get("/api/v1/alibaba/operations").json()}
    assert {"category_get", "schema_get", "photo_upload", "draft_create", "publish"} <= operations


def test_unconfigured_alibaba_endpoint_returns_service_unavailable() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/alibaba/categories/123")
    assert response.status_code == 503
