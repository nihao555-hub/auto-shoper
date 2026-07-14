from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.models import DraftField, FieldSource
from backend.app.services.field_tasks import build_field_tasks, confirmable_ai_field

SCHEMA = """
<schema>
  <field id="subject" name="Product title" type="input">
    <rules><rule name="requiredRule" value="true"/></rules>
  </field>
  <field id="minOrderQuantity" name="MOQ" type="input">
    <rules><rule name="requiredRule" value="true"/></rules>
  </field>
  <field id="color" name="Color" type="singleCheck">
    <rules><rule name="requiredRule" value="true"/></rules>
    <options>
      <option displayName="Black" value="black"/>
      <option displayName="White" value="white"/>
    </options>
  </field>
</schema>
"""

MULTI_COMPLEX_SCHEMA = """
<schema>
  <field id="sku" name="SKU" type="multiComplex">
    <fields>
      <field id="skuCode" name="SKU code" type="input">
        <rules><rule name="requiredRule" value="true"/></rules>
      </field>
      <field id="price" name="Price" type="input">
        <rules><rule name="requiredRule" value="true"/></rules>
      </field>
    </fields>
  </field>
</schema>
"""


def test_field_tasks_separate_confirmation_and_business_facts() -> None:
    result = build_field_tasks(
        SCHEMA,
        {
            "category_id": DraftField(value="123", source=FieldSource.USER_CONFIRMED),
            "subject": DraftField(
                value="Professional Brush",
                source=FieldSource.AI_GENERATED,
                evidence="Visible brush",
            ),
            "color": DraftField(
                value="black",
                source=FieldSource.IMAGE_EXTRACTED,
            ),
        },
        category_id="123",
    )

    tasks = {task.field_path: task for task in result.tasks}
    assert tasks["subject"].status == "confirm"
    assert tasks["subject"].question == "这个英文标题是否准确描述了商品？"
    assert tasks["minOrderQuantity"].status == "fill"
    assert tasks["minOrderQuantity"].question == "客户最少买多少件才能下单？"
    assert tasks["color"].status == "confirm"
    assert tasks["category_id"].status == "completed"
    assert result.summary.confirm == 2
    assert result.summary.fill == 1
    assert result.ready_to_draft is False


def test_field_tasks_reject_invalid_source_and_option() -> None:
    result = build_field_tasks(
        SCHEMA,
        {
            "category_id": DraftField(value="123", source=FieldSource.USER_CONFIRMED),
            "subject": DraftField(value="Brush", source=FieldSource.USER_CONFIRMED),
            "minOrderQuantity": DraftField(value="100", source=FieldSource.AI_GENERATED),
            "color": DraftField(value="purple", source=FieldSource.USER_CONFIRMED),
        },
        category_id="123",
    )
    tasks = {task.field_path: task for task in result.tasks}
    assert tasks["minOrderQuantity"].status == "invalid"
    assert "当前数据来源不允许用于此字段" in tasks["minOrderQuantity"].validation_errors
    assert tasks["color"].status == "invalid"
    assert "当前值不在 Alibaba 返回的可选项中" in tasks["color"].validation_errors


def test_only_ai_candidate_is_confirmable() -> None:
    assert confirmable_ai_field(SCHEMA, "subject") is not None
    assert confirmable_ai_field(SCHEMA, "minOrderQuantity") is None


def test_multi_complex_tasks_are_grouped_and_resolved_from_parent_value() -> None:
    result = build_field_tasks(
        MULTI_COMPLEX_SCHEMA,
        {
            "category_id": DraftField(value="123", source=FieldSource.USER_CONFIRMED),
            "sku": DraftField(
                value=[
                    {"skuCode": "BLACK-S", "price": "9.90"},
                    {"skuCode": "WHITE-M", "price": "10.90"},
                ],
                source=FieldSource.BUSINESS_SYSTEM,
            ),
        },
        category_id="123",
    )
    tasks = {task.field_path: task for task in result.tasks}
    assert tasks["sku.skuCode"].repeatable_group == "sku"
    assert tasks["sku.skuCode"].status == "completed"
    assert tasks["sku.price"].value == ["9.90", "10.90"]
    assert tasks["sku.price"].status == "completed"


def test_tasks_expose_value_rules_and_block_unsafe_required_choice() -> None:
    schema = r"""
    <schema>
      <field id="quantity" type="input">
        <rules>
          <rule name="requiredRule" value="true"/>
          <rule name="valueTypeRule" value="integer"/>
          <rule name="minValueRule" value="1"/>
          <rule name="maxValueRule" value="999"/>
          <rule name="regxRule" value="[0-9]+"/>
        </rules>
      </field>
      <field id="warehouse" type="singleCheck">
        <rules><rule name="requiredRule" value="true"/></rules>
      </field>
      <field id="inventory" type="multiInput">
        <rules>
          <rule name="valueAttributeRule" value="warehouseCode"/>
          <rule name="maxInputNumRule" value="3"/>
        </rules>
      </field>
    </schema>
    """
    result = build_field_tasks(schema, {}, category_id="123")
    tasks = {task.field_path: task for task in result.tasks}
    assert tasks["quantity"].control_type == "number"
    assert tasks["quantity"].value_type == "integer"
    assert tasks["quantity"].min_value == "1"
    assert tasks["quantity"].max_value == "999"
    assert tasks["quantity"].pattern == "[0-9]+"
    assert tasks["warehouse"].status == "invalid"
    assert tasks["warehouse"].supported is False
    assert "禁止按文本猜测" in (tasks["warehouse"].support_message or "")
    assert tasks["inventory"].value_attributes == ["warehouseCode"]
    assert tasks["inventory"].max_input_num == 3


def test_tasks_endpoint_returns_summary(authenticated_app: None) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/products/official-listing/tasks",
        json={
            "category_id": "123",
            "schema_data": SCHEMA,
            "fields": {
                "category_id": {"value": "123", "source": "user_confirmed"},
                "subject": {"value": "Brush", "source": "ai_generated"},
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["summary"]["confirm"] == 1
    assert response.json()["summary"]["fill"] == 2


def test_confirmation_endpoint_only_promotes_ai_candidate(authenticated_app: None) -> None:
    client = TestClient(app)
    payload = {
        "batch_id": "batch-confirmation",
        "reference": "SKU-001",
        "field_path": "subject",
        "value": "Professional Brush",
        "original_source": "ai_generated",
        "evidence": "Visible product",
        "schema_data": SCHEMA,
    }
    response = client.post(
        "/api/v1/products/official-listing/fields/confirm",
        json=payload,
    )
    assert response.status_code == 200
    field = response.json()["field"]
    assert field["source"] == "user_confirmed"
    assert field["confirmation_id"] == "test-confirmation"

    rejected = client.post(
        "/api/v1/products/official-listing/fields/confirm",
        json={**payload, "field_path": "minOrderQuantity", "value": "100"},
    )
    assert rejected.status_code == 409

    category = client.post(
        "/api/v1/products/official-listing/fields/confirm",
        json={**payload, "field_path": "category_id", "value": "123"},
    )
    assert category.status_code == 200
    assert category.json()["field_path"] == "category_id"
