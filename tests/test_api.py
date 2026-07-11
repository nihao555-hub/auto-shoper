from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient

from backend.app.clients.alibaba import AlibabaClient, AlibabaConfigurationError
from backend.app.config import Settings
from backend.app.dependencies import get_alibaba_client
from backend.app.main import app

SCHEMA_XML = "<itemSchema><field id=\"productTitle\" type=\"input\" /></itemSchema>"


class FakeAlibabaClient:
    async def call(
        self,
        operation: str,
        parameters: dict[str, object] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
    ) -> dict[str, object]:
        return {
            "success": True,
            "operation": operation,
            "parameters": parameters or {},
            "file_fields": sorted(files) if files else [],
        }


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
            json={"category_id": "123", "xml": SCHEMA_XML, "confirmed_by_user": False},
        )
        assert response.status_code == 409
        confirmed = client.post(
            "/api/v1/alibaba/products/publish",
            json={"category_id": "123", "xml": SCHEMA_XML, "confirmed_by_user": True},
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["operation"] == "/icbu/product/schema/add"
        assert confirmed.json()["parameters"]["publish_request"] == {
            "language": "en_US",
            "cat_id": "123",
            "xml": SCHEMA_XML,
        }
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


def test_unconfigured_alibaba_client_is_rejected() -> None:
    settings = Settings(
        _env_file=None,
        alibaba_app_key=None,
        alibaba_app_secret=None,
        alibaba_access_token=None,
    )
    with pytest.raises(AlibabaConfigurationError):
        AlibabaClient(settings)


def test_batch_drafts_return_one_result_per_item() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/alibaba/products/batch/drafts",
            json={
                    "items": [
                    {"reference": "A", "category_id": "123", "xml": SCHEMA_XML},
                    {"reference": "B", "category_id": "123", "xml": SCHEMA_XML},
                ],
                "concurrency": 2,
            },
        )
        assert response.status_code == 200
        assert [item["reference"] for item in response.json()] == ["A", "B"]
        assert all(item["success"] for item in response.json())
        assert response.json()[0]["response"]["parameters"][
            "param_product_top_publish_request"
        ]["xml"] == SCHEMA_XML
    finally:
        app.dependency_overrides.clear()


def test_batch_publish_requires_confirmation() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/alibaba/products/batch/publish",
            json={
                "items": [{"reference": "A", "category_id": "123", "xml": SCHEMA_XML}],
                "confirmed_by_user": False,
            },
        )
        assert response.status_code == 409
    finally:
        app.dependency_overrides.clear()


def test_batch_requires_unique_references() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/alibaba/products/batch/drafts",
        json={
            "items": [
                {"reference": "duplicate", "category_id": "123", "xml": SCHEMA_XML},
                {"reference": "duplicate", "category_id": "123", "xml": SCHEMA_XML},
            ]
        },
    )
    assert response.status_code == 422


def test_render_draft_uses_product_and_category_ids() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/alibaba/products/drafts/render",
            json={"category_id": "123", "product_id": "456", "language": "en_US"},
        )
        assert response.status_code == 200
        assert response.json()["parameters"] == {
            "cat_id": "123",
            "product_id": "456",
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
            json={"sku_id": "sku-1", "inventory": 20},
        )
        assert inventory.status_code == 200
        assert inventory.json()["parameters"] == {
            "product_id": "product-1",
            "inventory_list": [
                {
                    "sku_id": "sku-1",
                    "inventory": 20,
                    "inventory_code": "CN_LOCAL_01",
                }
            ],
        }

        display = client.patch(
            "/api/v1/alibaba/products/product-1/display",
            json={"display": False},
        )
        assert display.status_code == 200
        assert display.json()["parameters"] == {
            "new_display": "N",
            "product_id_list": ["product-1"],
        }
    finally:
        app.dependency_overrides.clear()


def test_inventory_update_requires_non_negative_inventory() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        missing = client.put(
            "/api/v1/alibaba/products/product-1/inventory",
            json={"sku_id": "sku-1"},
        )
        negative = client.put(
            "/api/v1/alibaba/products/product-1/inventory",
            json={"sku_id": "sku-1", "inventory": -1},
        )
        assert missing.status_code == 422
        assert negative.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_schema_update_and_photo_bank_queries() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        updated = client.patch(
            "/api/v1/alibaba/products/product-1/schema",
            json={"category_id": "123", "xml": SCHEMA_XML},
        )
        assert updated.status_code == 200
        assert updated.json()["operation"] == "/icbu/product/schema/update"
        assert updated.json()["parameters"] == {
            "xml": SCHEMA_XML,
            "product_id": "product-1",
            "cat_id": "123",
            "language": "en_US",
        }

        groups = client.get("/api/v1/alibaba/photo-bank/groups?page_size=10")
        assert groups.status_code == 200
        assert groups.json()["parameters"]["request"]["pageSize"] == 10

        images = client.get("/api/v1/alibaba/photo-bank/images?group_id=group-1")
        assert images.status_code == 200
        assert images.json()["parameters"]["request"]["groupId"] == "group-1"

        uploaded = client.post(
            "/api/v1/alibaba/photo-bank/images",
            data={"group_id": "group-1"},
            files={"image": ("brush.jpg", b"image", "image/jpeg")},
        )
        assert uploaded.status_code == 200
        assert uploaded.json()["operation"] == "/alibaba/icbu/photobank/upload"
        assert uploaded.json()["parameters"] == {
            "file_name": "brush.jpg",
            "group_id": "group-1",
        }
        assert uploaded.json()["file_fields"] == ["image_bytes"]
    finally:
        app.dependency_overrides.clear()


def test_parse_schema_extracts_official_rules_and_manual_fields() -> None:
    client = TestClient(app)
    schema_xml = """
    <schema>
      <fields>
        <field id="productTitle" name="Product name" type="input">
          <rules>
            <rule name="requiredRule" value="true"/>
            <rule name="maxLengthRule" value="128" unit="byte"/>
            <rule name="valueTypeRule" value="text"/>
          </rules>
        </field>
        <field id="priceUnit" name="Unit" type="singleCheck">
          <rules><rule name="requiredRule" value="true"/></rules>
          <options>
            <option displayName="Piece/Pieces" value="100000015"/>
            <option displayName="Other" value="-1"/>
          </options>
        </field>
        <field id="sku" type="multiComplex">
          <fields>
            <field id="skuStock" name="Quantity in stock" type="multiInput">
              <rules><rule name="requiredRule" value="true"/></rules>
            </field>
          </fields>
        </field>
      </fields>
    </schema>
    """
    response = client.post("/api/v1/alibaba/schemas/parse", json={"schema_data": schema_xml})
    assert response.status_code == 200
    body = response.json()
    assert body["required_field_ids"] == ["priceUnit", "productTitle"]
    assert "priceUnit" in body["manual_confirmation_field_ids"]
    assert "sku.skuStock" in body["manual_confirmation_field_ids"]
    assert body["fields"][1]["options"][0] == {
        "display_name": "Piece/Pieces",
        "value": "100000015",
    }


def test_validate_product_uses_schema_xml_required_and_manual_policy() -> None:
    client = TestClient(app)
    schema_xml = """
    <schema>
      <field id="productTitle" type="input">
        <rules><rule name="requiredRule" value="true"/></rules>
      </field>
      <field id="ladderPrice" type="complex">
        <rules><rule name="requiredRule" value="true"/></rules>
      </field>
    </schema>
    """
    response = client.post(
        "/api/v1/products/official-listing/validate",
        json={
            "schema_data": schema_xml,
            "fields": {
                "category_id": {"value": "123", "source": "user_provided"},
                "ladderPrice": {"value": "9.99", "source": "ai_generated"},
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ready_to_publish"] is False
    assert body["missing_fields"] == ["productTitle"]
    assert body["invalid_ai_fields"] == ["ladderPrice"]
    assert "ladderPrice" in body["manual_confirmation_fields"]
    assert any(item["phase"] == "trade_sku" for item in body["checklist"])


def test_official_listing_flow_documents_backend_sequence() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/alibaba/listing-flow")
    assert response.status_code == 200
    body = response.json()
    assert [step["phase"] for step in body["steps"]] == [
        "authorization",
        "category_schema",
        "media_ai",
        "product_data",
        "draft_preview",
        "publish_audit",
        "post_publish",
    ]
    assert "POST /api/v1/alibaba/schemas/parse" in body["steps"][1]["backend_endpoints"]
