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
    assert {
        "category_get",
        "schema_get",
        "photo_upload",
        "draft_create",
        "draft_render",
        "publish",
        "schema_update",
        "inventory_update",
        "display_update",
    } <= operations


def test_unconfigured_alibaba_endpoint_returns_service_unavailable() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/alibaba/categories/123")
    assert response.status_code == 503


def test_batch_drafts_return_one_result_per_item() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/alibaba/products/batch/drafts",
            json={
                "items": [
                    {"reference": "A", "category_id": "123", "schema_data": {"title": "A"}},
                    {"reference": "B", "category_id": "123", "schema_data": {"title": "B"}},
                ],
                "concurrency": 2,
            },
        )
        assert response.status_code == 200
        assert [item["reference"] for item in response.json()] == ["A", "B"]
        assert all(item["success"] for item in response.json())
    finally:
        app.dependency_overrides.clear()


def test_batch_publish_requires_confirmation() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/alibaba/products/batch/publish",
            json={
                "items": [{"category_id": "123", "schema_data": {}}],
                "confirmed_by_user": False,
            },
        )
        assert response.status_code == 409
    finally:
        app.dependency_overrides.clear()


def test_render_draft_supports_gop_draft_id() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/alibaba/products/drafts/render",
            json={"draft_id": "draft-1", "language": "en_US"},
        )
        assert response.status_code == 200
        assert response.json()["parameters"] == {
            "draft_id": "draft-1",
            "language": "en_US",
        }
    finally:
        app.dependency_overrides.clear()


def test_inventory_and_display_requests_use_gop_request_shapes() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        inventory = client.put(
            "/api/v1/alibaba/products/product-1/inventory",
            json={"sku_id": "sku-1", "amount": 20},
        )
        assert inventory.status_code == 200
        assert inventory.json()["parameters"]["inventory_update_request"] == {
            "inventoryItems": [
                {
                    "productId": "product-1",
                    "skuId": "sku-1",
                    "inventory": {"amount": 20},
                }
            ]
        }

        display = client.patch(
            "/api/v1/alibaba/products/product-1/display",
            json={"display": False},
        )
        assert display.status_code == 200
        assert display.json()["parameters"]["request"] == {
            "productId": "product-1",
            "display": False,
        }
    finally:
        app.dependency_overrides.clear()


def test_inventory_update_requires_exactly_one_amount_mode() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        missing = client.put(
            "/api/v1/alibaba/products/product-1/inventory",
            json={"sku_id": "sku-1"},
        )
        both = client.put(
            "/api/v1/alibaba/products/product-1/inventory",
            json={"sku_id": "sku-1", "amount": 10, "amount_diff": 2},
        )
        assert missing.status_code == 422
        assert both.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_schema_update_and_photo_bank_queries() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        updated = client.patch(
            "/api/v1/alibaba/schemas/schema-1",
            json={"schema_data": {"productTitle": "Updated"}},
        )
        assert updated.status_code == 200
        assert updated.json()["operation"] == "/icbu/product/schema/update"

        groups = client.get("/api/v1/alibaba/photo-bank/groups?page_size=10")
        assert groups.status_code == 200
        assert groups.json()["parameters"]["request"]["pageSize"] == 10

        images = client.get("/api/v1/alibaba/photo-bank/images?group_id=group-1")
        assert images.status_code == 200
        assert images.json()["parameters"]["request"]["groupId"] == "group-1"
    finally:
        app.dependency_overrides.clear()
