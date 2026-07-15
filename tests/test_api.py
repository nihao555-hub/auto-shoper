from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient

from backend.app.clients.ai import AIProviderError
from backend.app.clients.alibaba import AlibabaClient, AlibabaConfigurationError
from backend.app.config import Settings
from backend.app.dependencies import get_ai_client, get_alibaba_client
from backend.app.main import app
from backend.app.models import (
    ProductContentTranslationRequest,
    ProductContentTranslationResponse,
    ProductImageAnalysis,
)

SCHEMA_XML = '<itemSchema><field id="productTitle" type="input" /></itemSchema>'

pytestmark = pytest.mark.usefixtures("authenticated_app")


class FakeAlibabaClient:
    async def call(
        self,
        operation: str,
        parameters: dict[str, object] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
    ) -> dict[str, object]:
        if "category/schema/level/get" in operation:
            return {
                "result": {
                    "data": """
                    <itemSchema>
                      <field id="icbuCatProp" type="complex">
                        <fields>
                          <field id="supplyType" name="Supply type" type="singleCheck">
                            <rules>
                              <rule name="requiredRule" value="true"/>
                              <rule name="asyncQueryRule"
                                value="top.tmall.post.item.query.subProp.schema.get"/>
                            </rules>
                            <options><option displayName="OEM" value="oem"/></options>
                          </field>
                        </fields>
                      </field>
                    </itemSchema>
                    """
                }
            }
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
    received_field_guidance: str | None = None
    edit_prompts: list[str] = []

    async def analyze_product_images(
        self,
        images: list[tuple[bytes, str]],
        known_facts: dict[str, object],
        category_hint: str | None,
        field_guidance: str | None = None,
    ) -> ProductImageAnalysis:
        self.received_image_count = len(images)
        self.received_field_guidance = field_guidance
        return ProductImageAnalysis(
            observed_fields={},
            generated_fields={},
            category_suggestions=[],
            manual_requirements=[],
            warnings=[],
        )

    async def edit_product_image(
        self,
        references: list[tuple[bytes, str, str]],
        prompt: str,
        size: str,
        count: int,
    ) -> dict[str, object]:
        self.edit_prompts.append(prompt)
        self.received_reference_count = len(references)
        return {
            "data": [{"url": "https://example.test/generated.png"}],
            "requires_confirmation": True,
            "source_image_preservation_required": True,
        }

    async def translate_product_content(
        self,
        request: ProductContentTranslationRequest,
    ) -> ProductContentTranslationResponse:
        return ProductContentTranslationResponse(
            target_language_code=request.target_language_code,
            target_language=request.target_language,
            title="Professionelles Pinselset",
            keywords=["Pinselset"],
            selling_points=["Nylonborsten"],
            description="Käuferorientierte Übersetzung.",
        )


fake_ai = FakeAIClient()


async def fake_ai_client() -> AsyncIterator[FakeAIClient]:
    yield fake_ai


class FailingTranslationAIClient(FakeAIClient):
    async def translate_product_content(
        self,
        request: ProductContentTranslationRequest,
    ) -> ProductContentTranslationResponse:
        raise AIProviderError("translation provider unavailable")


async def failing_translation_ai_client() -> AsyncIterator[FailingTranslationAIClient]:
    yield FailingTranslationAIClient()


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


def test_product_analysis_passes_schema_field_guidance_to_ai() -> None:
    app.dependency_overrides[get_ai_client] = fake_ai_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/products/analyze-image",
            files=[("images", ("main.jpg", b"main", "image/jpeg"))],
            data={"known_facts": "{}", "schema_data": SCHEMA_XML},
        )
        assert response.status_code == 200
        assert fake_ai.received_field_guidance is not None
        assert "productTitle" in fake_ai.received_field_guidance
    finally:
        app.dependency_overrides.clear()


def test_product_translation_returns_only_localized_copy_fields() -> None:
    app.dependency_overrides[get_ai_client] = fake_ai_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/products/translate-content",
            json={
                "target_language_code": "de-DE",
                "target_language": "German",
                "title": "Professional Paint Brush Set",
                "keywords": ["paint brush set"],
                "selling_points": ["nylon bristles"],
                "description": "Buyer-facing copy.",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["target_language_code"] == "de-DE"
        assert body["title"] == "Professionelles Pinselset"
        assert set(body) == {
            "target_language_code",
            "target_language",
            "title",
            "keywords",
            "selling_points",
            "description",
        }
    finally:
        app.dependency_overrides.clear()


def test_product_translation_returns_provider_errors_as_bad_gateway() -> None:
    app.dependency_overrides[get_ai_client] = failing_translation_ai_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/products/translate-content",
            json={
                "target_language_code": "de-DE",
                "target_language": "German",
                "title": "Professional Paint Brush Set",
            },
        )
        assert response.status_code == 502
        assert response.json()["detail"] == "translation provider unavailable"
    finally:
        app.dependency_overrides.clear()


def test_generate_product_images_uses_reference_image_to_image() -> None:
    app.dependency_overrides[get_ai_client] = fake_ai_client
    fake_ai.edit_prompts = []
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/products/p1/generate-images",
            files=[
                ("references", ("main.jpg", b"main", "image/jpeg")),
                ("references", ("detail.png", b"detail", "image/png")),
            ],
            data={
                "request": (
                    '{"product_id":"p1","title":"Pad","category":"Paper",'
                    '"description":"","keywords":[],"slots":["main","detail"]}'
                )
            },
        )
        assert response.status_code == 200
        body = response.json()
        slots = [candidate["slot"] for candidate in body["candidates"]]
        assert slots == ["main", "detail"]
        assert all(candidate["requires_confirmation"] for candidate in body["candidates"])
        assert len(fake_ai.edit_prompts) == 2
        # Every slot receives the full set of reference images.
        assert fake_ai.received_reference_count == 2
    finally:
        app.dependency_overrides.clear()


def test_generate_product_images_accepts_single_reference_field() -> None:
    app.dependency_overrides[get_ai_client] = fake_ai_client
    fake_ai.edit_prompts = []
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/products/p1/generate-images",
            files=[("reference", ("main.jpg", b"main", "image/jpeg"))],
            data={
                "request": (
                    '{"product_id":"p1","title":"Pad","category":"Paper",'
                    '"description":"","keywords":[],"slots":["main"]}'
                )
            },
        )
        assert response.status_code == 200
        assert fake_ai.received_reference_count == 1
    finally:
        app.dependency_overrides.clear()


def test_generate_product_images_falls_back_to_primary_when_multi_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app.dependency_overrides[get_ai_client] = fake_ai_client
    fake_ai.edit_prompts = []
    single_ref_settings = Settings(_env_file=None, image_multi_reference=False)
    monkeypatch.setattr("backend.app.routes.get_settings", lambda: single_ref_settings)
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/products/p1/generate-images",
            files=[
                ("references", ("main.jpg", b"main", "image/jpeg")),
                ("references", ("detail.png", b"detail", "image/png")),
            ],
            data={
                "request": (
                    '{"product_id":"p1","title":"Pad","category":"Paper",'
                    '"description":"","keywords":[],"slots":["main"]}'
                )
            },
        )
        assert response.status_code == 200
        # Two references uploaded, but only the primary one reaches the model.
        assert fake_ai.received_reference_count == 1
    finally:
        app.dependency_overrides.clear()


def test_product_image_plan_skips_existing_slots_and_requests_missing_facts() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/products/p1/image-plan",
        json={
            "product_id": "p1",
            "title": "Pad",
            "category": "Paper",
            "description": "",
            "keywords": [],
            "existing_slots": ["main"],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["target_language"] == "en_US"
    slots = {item["slot"]: item for item in body["slots"]}
    assert "main" not in slots
    assert slots["detail"]["can_generate"] is True
    assert slots["scenario"]["missing_user_inputs"][0]["key"] == "use_scenario"
    assert slots["specification"]["missing_user_inputs"][0]["key"] == "product_dimensions"
    assert slots["packaging"]["missing_user_inputs"][0]["key"] == "packaging_details"


def test_image_prompt_templates_lists_required_slots() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/images/prompt-templates")
    assert response.status_code == 200
    templates = {item["slot"]: item for item in response.json()}
    assert templates["main"]["required"] is True
    assert templates["main"]["schema_field"] == "scImages"
    assert templates["detail"]["schema_field"] == "detailImage"


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
    assert response.headers["location"].endswith("?alibaba=error&reason=missing_callback_data")


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
    catalog = client.get("/api/v1/alibaba/operations").json()
    operations = {item["key"] for item in catalog}
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
    category_operation = next(item for item in catalog if item["key"] == "category_get")
    assert category_operation["operation"] == "/icbu/product/category/get"


def test_category_schema_uses_official_request_envelope() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        response = client.get(
            "/api/v1/alibaba/categories/21111199/schema",
            params={"language": "en_US"},
        )
        assert response.status_code == 200
        assert response.json()["parameters"] == {
            "param_product_top_publish_request": {
                "cat_id": "21111199",
                "language": "en_US",
            }
        }
    finally:
        app.dependency_overrides.clear()


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
        assert (
            response.json()[0]["response"]["parameters"]["param_product_top_publish_request"]["xml"]
            == SCHEMA_XML
        )
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
                ],
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

        product_groups = client.get("/api/v1/alibaba/product-groups")
        assert product_groups.status_code == 200
        assert product_groups.json()["operation"] == "/alibaba/icbu/product/group/get"
        assert product_groups.json()["parameters"] == {
            "group_id": -1,
            "extra_context": "{}",
        }

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
        "valid": True,
        "attributes": {},
    }


def test_parse_schema_preserves_conditional_disable_and_option_metadata() -> None:
    client = TestClient(app)
    schema_xml = """
    <schema>
      <field id="mode" type="singleCheck">
        <options>
          <option displayName="可用" value="1" valid="true" code="A"/>
          <option displayName="停用" value="2" valid="false"/>
        </options>
      </field>
      <field id="startDate" type="input">
        <rules>
          <rule name="valueTypeRule" value="date"/>
          <rule name="disableRule" value="true">
            <depend-group operator="and">
              <depend-express fieldId="mode" value="1" symbol="!="/>
            </depend-group>
          </rule>
        </rules>
      </field>
    </schema>
    """
    response = client.post("/api/v1/alibaba/schemas/parse", json={"schema_data": schema_xml})
    assert response.status_code == 200
    fields = {field["id"]: field for field in response.json()["fields"]}
    assert fields["startDate"]["disabled"] is False
    assert fields["startDate"]["conditional_disable"][0]["expressions"][0] == {
        "field_id": "mode",
        "value": "1",
        "symbol": "!=",
    }
    assert fields["mode"]["options"][0]["attributes"] == {"code": "A"}
    assert fields["mode"]["options"][1]["valid"] is False


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


def test_official_listing_async_options_use_controlled_schema_level_api() -> None:
    app.dependency_overrides[get_alibaba_client] = fake_alibaba_client
    try:
        client = TestClient(app)
        schema_xml = """
        <itemSchema>
          <field id="icbuCatProp" type="complex">
            <fields>
              <field id="supplyType" name="Supply type" type="singleCheck">
                <rules>
                  <rule name="requiredRule" value="true"/>
                  <rule name="asyncQueryRule" value="top.tmall.post.item.query.subProp.schema.get"/>
                </rules>
              </field>
            </fields>
          </field>
        </itemSchema>
        """
        response = client.post(
            "/api/v1/products/official-listing/options",
            json={
                "category_id": "333",
                "field_path": "icbuCatProp.supplyType",
                "schema_data": schema_xml,
                "fields": {"category_id": {"value": "333", "source": "user_confirmed"}},
            },
        )
        assert response.status_code == 200
        fields = response.json()["manual_fact_fields"]
        supply_type = next(item for item in fields if item["field"].endswith("supplyType"))
        assert supply_type["options"] == [
            {"display_name": "OEM", "value": "oem", "valid": True, "attributes": {}}
        ]
    finally:
        app.dependency_overrides.pop(get_alibaba_client, None)


def test_listing_field_matrix_separates_store_and_product_inputs() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/alibaba/listing-field-matrix")
    assert response.status_code == 200
    groups = {group["key"]: group for group in response.json()}
    assert groups["store_ai_assisted"]["scope"] == "store"
    assert groups["product_ai_assisted"]["scope"] == "product"
    assert groups["product_trusted_facts"]["input_mode"] == "trusted_only"
    assert any(field["name"] == "price" for field in groups["product_trusted_facts"]["fields"])


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


def test_prepare_official_listing_builds_complex_values_from_api_field_paths() -> None:
    client = TestClient(app)
    schema_xml = """
    <schema>
      <field id="shippingTemplate" type="complex">
        <fields>
          <field id="templateType" type="singleCheck">
            <rules><rule name="requiredRule" value="true"/></rules>
            <options><option value="aliLogistics"/></options>
          </field>
          <field id="shippingTemplateId" type="input">
            <rules><rule name="requiredRule" value="true"/></rules>
          </field>
        </fields>
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
                "shippingTemplate.templateType": {
                    "value": "aliLogistics",
                    "source": "account_default",
                },
                "shippingTemplate.shippingTemplateId": {
                    "value": "42",
                    "source": "account_default",
                },
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ready_to_draft"] is True
    assert body["missing_fields"] == []
    assert '<field id="shippingTemplateId"' in body["xml"]
    assert "<value>42</value>" in body["xml"]


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
        assert response.json()[0]["response"]["_readback"]["success"] is True
        assert response.json()[0]["response"]["_differences"] == []
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


def test_official_listing_import_endpoint_normalizes_csv() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/v1/products/official-listing/import",
        files={
            "file": (
                "products.csv",
                "商品编码,标题,库存\nCSV-1,Imported title,42\n".encode(),
                "text/csv",
            )
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["format"] == "csv"
    assert payload["rows"][0]["reference"] == "CSV-1"
    assert payload["rows"][0]["fields"]["inventory"] == {
        "value": "42",
        "display_value_zh": None,
        "source": "business_system",
        "confidence": None,
        "requires_confirmation": False,
        "evidence": None,
        "confirmation_id": None,
        "confirmed_at": None,
        "confirmed_by": None,
    }
