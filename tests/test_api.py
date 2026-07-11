from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient

from backend.app.clients.alibaba import AlibabaClient, AlibabaConfigurationError
from backend.app.config import Settings
from backend.app.dependencies import get_ai_client, get_alibaba_client
from backend.app.main import app
from backend.app.models import ProductImageAnalysis

SCHEMA_XML = "<itemSchema><field id=\"productTitle\" type=\"input\" /></itemSchema>"

pytestmark = pytest.mark.usefixtures("authenticated_app")


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


class FakeAIClient:
    received_image_count = 0

    async def analyze_product_images(
        self,
        images: list[tuple[bytes, str]],
        known_facts: dict[str, object],
        category_hint: str | None,
    ) -> ProductImageAnalysis:
        self.received_image_count = len(images)
        return ProductImageAnalysis(
            observed_fields={},
            generated_fields={},
            category_suggestions=[],
            manual_requirements=[],
            warnings=[],
        )


fake_ai = FakeAIClient()


async def fake_ai_client() -> AsyncIterator[FakeAIClient]:
    yield fake_ai


def test_health_and_capabilities() -> None:
    client = TestClient(app)
    assert client.get("/health").json() == {"status": "ok"}
    capabilities = client.get("/api/v1/capabilities").json()
    assert capabilities["modules"]["sales_expert"] is False


def test_product_analysis_accepts_multiple_images_for_one_product() -> None:
    app.dependency_overrides[get_ai_client] = fake_ai_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/products/analyze-image",
            files=[
                ("images", ("main.jpg", b"main", "image/jpeg")),
                ("images", ("detail.png", b"detail", "image/png")),
                ("images", ("spec.png", b"spec", "image/png")),
            ],
            data={"known_facts": "{}"},
        )
        assert response.status_code == 200
        assert fake_ai.received_image_count == 3
    finally:
        app.dependency_overrides.clear()


def test_oauth_callback_redirects_provider_errors_to_frontend() -> None:
    client = TestClient(app, follow_redirects=False)

    response = client.get(
        "/api/v1/alibaba/oauth/callback",
        params={"error": "access_denied", "error_description": "merchant cancelled"},
    )

    assert response.status_code == 307
    assert response.headers["location"].endswith("?alibaba=error&reason=denied")


def test_oauth_callback_redirects_missing_code_or_state_to_frontend() -> None:
    client = TestClient(app, follow_redirects=False)

    response = client.get("/api/v1/alibaba/oauth/callback", params={"code": "code-only"})

    assert response.status_code == 307
    assert response.headers["location"].endswith(
        "?alibaba=error&reason=missing_callback_data"
    )


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
                "batch_id": "test-batch-drafts",
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
                "batch_id": "test-batch-publish",
                "items": [{"reference": "A", "category_id": "123", "xml": SCHEMA_XML}],
                "confirmed_by_user": False,
            },
        )
        assert response.status_code == 409
    finally:
        app.dependency_overrides.clear()


def test_batch_requires_unique_references() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/alibaba/products/batch/drafts",
            json={
                "batch_id": "test-batch-duplicate",
                "items": [
                    {"reference": "duplicate", "category_id": "123", "xml": SCHEMA_XML},
                    {"reference": "duplicate", "category_id": "123", "xml": SCHEMA_XML},
                ]
            },
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


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
        assert images.json()["parameters"]["groupId"] == "group-1"

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
    assert {group["key"] for group in body["field_groups"]} == {
        "store_ai_assisted",
        "store_trusted_defaults",
        "product_ai_assisted",
        "product_trusted_facts",
    }


def test_listing_field_matrix_separates_store_and_product_inputs() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/alibaba/listing-field-matrix")
    assert response.status_code == 200
    groups = {group["key"]: group for group in response.json()}
    assert groups["store_ai_assisted"]["scope"] == "store"
    assert groups["product_ai_assisted"]["scope"] == "product"
    assert groups["product_trusted_facts"]["input_mode"] == "trusted_only"
    assert any(
        field["name"] == "price"
        for field in groups["product_trusted_facts"]["fields"]
    )


def test_prepare_official_listing_merges_trusted_store_defaults() -> None:
    client = TestClient(app)
    schema_xml = """
    <schema>
      <field id="productTitle" type="input">
        <rules><rule name="requiredRule" value="true"/></rules>
      </field>
      <field id="priceUnit" type="singleCheck">
        <rules><rule name="requiredRule" value="true"/></rules>
        <options><option value="100000015"/></options>
      </field>
    </schema>
    """
    response = client.post(
        "/api/v1/products/official-listing/prepare",
        json={
            "category_id": "123",
            "schema_data": schema_xml,
            "fields": {
                "category_id": {"value": "123", "source": "user_confirmed"},
                "productTitle": {
                    "value": "Professional Paint Brush",
                    "source": "user_confirmed",
                },
            },
            "account_defaults": {
                "price_unit": {
                    "value": "100000015",
                    "source": "account_default",
                }
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ready_to_draft"] is True
    assert body["invalid_default_fields"] == []
    assert "<value>Professional Paint Brush</value>" in body["xml"]
    assert "<value>100000015</value>" in body["xml"]


def test_prepare_official_listing_rejects_ai_business_fact_and_category_mismatch() -> None:
    client = TestClient(app)
    schema_xml = """
    <schema>
      <field id="price" type="input">
        <rules><rule name="requiredRule" value="true"/></rules>
      </field>
    </schema>
    """
    response = client.post(
        "/api/v1/products/official-listing/prepare",
        json={
            "category_id": "123",
            "schema_data": schema_xml,
            "fields": {
                "category_id": {"value": "456", "source": "user_confirmed"},
                "price": {
                    "value": "9.99",
                    "source": "ai_generated",
                    "requires_confirmation": False,
                },
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ready_to_draft"] is False
    assert body["invalid_ai_fields"] == ["price"]
    assert body["confirmation_fields"] == ["price"]
    assert body["invalid_default_fields"] == ["category_id"]


def test_official_listing_write_path_builds_schema_from_trusted_sources() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        schema_xml = """
        <schema>
          <field id="productTitle" type="input">
            <rules><rule name="requiredRule" value="true"/></rules>
          </field>
        </schema>
        """
        payload = {
            "category_id": "123",
            "schema_data": schema_xml,
            "fields": {
                "category_id": {"value": "123", "source": "user_confirmed"},
                "productTitle": {
                    "value": "Professional Paint Brush",
                    "source": "user_confirmed",
                },
            },
        }
        draft = client.post("/api/v1/products/official-listing/drafts", json=payload)
        assert draft.status_code == 200
        draft_request = draft.json()["parameters"]["param_product_top_publish_request"]
        assert draft_request["cat_id"] == "123"
        assert "<value>Professional Paint Brush</value>" in draft_request["xml"]

        unconfirmed = client.post(
            "/api/v1/products/official-listing/publish",
            json=payload,
        )
        assert unconfirmed.status_code == 409

        confirmed = client.post(
            "/api/v1/products/official-listing/publish",
            json={**payload, "confirmed_by_user": True},
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["parameters"]["publish_request"]["cat_id"] == "123"
    finally:
        app.dependency_overrides.clear()


def test_official_listing_write_path_blocks_unconfirmed_ai_content() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/products/official-listing/drafts",
            json={
                "category_id": "123",
                "schema_data": SCHEMA_XML,
                "fields": {
                    "category_id": {"value": "123", "source": "user_confirmed"},
                    "productTitle": {
                        "value": "AI title",
                        "source": "ai_generated",
                        "requires_confirmation": False,
                    },
                },
            },
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["confirmation_fields"] == ["productTitle"]
    finally:
        app.dependency_overrides.clear()


def test_official_listing_batch_isolates_source_validation_failures() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)

        def item(reference: str, source: str) -> dict[str, object]:
            return {
                "reference": reference,
                "category_id": "123",
                "schema_data": SCHEMA_XML,
                "fields": {
                    "category_id": {"value": "123", "source": "user_confirmed"},
                    "productTitle": {"value": reference, "source": source},
                },
            }

        response = client.post(
            "/api/v1/products/official-listing/batch/drafts",
            json={
                "batch_id": "test-official-drafts",
                "items": [
                    item("trusted", "user_confirmed"),
                    item("ai-candidate", "ai_generated"),
                ],
                "concurrency": 2,
            },
        )
        assert response.status_code == 200
        assert [entry["reference"] for entry in response.json()] == [
            "trusted",
            "ai-candidate",
        ]
        assert response.json()[0]["success"] is True
        assert response.json()[1]["success"] is False
        assert '"confirmation_fields":["productTitle"]' in response.json()[1]["error"]

        unconfirmed = client.post(
            "/api/v1/products/official-listing/batch/publish",
            json={
                "batch_id": "test-official-publish",
                "items": [item("trusted", "user_confirmed")],
            },
        )
        assert unconfirmed.status_code == 409
    finally:
        app.dependency_overrides.clear()
