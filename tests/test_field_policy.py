import pytest

from backend.app.models import DraftField, FieldSource
from backend.app.services.field_policy import (
    MANUAL_FIELD_NAMES,
    schema_field_responsibility,
    validate_product_fields,
)


def trusted_fields() -> dict[str, DraftField]:
    return {
        name: DraftField(value="provided", source=FieldSource.USER_PROVIDED)
        for name in MANUAL_FIELD_NAMES
    }


def test_manual_fields_cannot_come_from_ai() -> None:
    fields = trusted_fields()
    fields["price"] = DraftField(value="9.99", source=FieldSource.AI_GENERATED)
    result = validate_product_fields(fields, [])
    assert result.ready_to_publish is False
    assert result.invalid_ai_fields == ["price"]


def test_confirmation_blocks_publish_readiness() -> None:
    fields = trusted_fields()
    fields["title"] = DraftField(
        value="Portable desk lamp",
        source=FieldSource.AI_GENERATED,
        requires_confirmation=True,
    )
    result = validate_product_fields(fields, [])
    assert result.ready_to_publish is False
    assert result.confirmation_fields == ["title"]


def test_all_trusted_required_fields_are_ready() -> None:
    result = validate_product_fields(trusted_fields(), [])
    assert result.ready_to_publish is True


def test_schema_required_field_is_enforced() -> None:
    fields = trusted_fields()
    result = validate_product_fields(fields, ["voltage"])
    assert result.ready_to_publish is False
    assert result.missing_fields == ["voltage"]


def test_complex_schema_parent_is_satisfied_by_trusted_child_fields() -> None:
    fields = trusted_fields()
    fields["shippingTemplate.shippingTemplateId"] = DraftField(
        value="42",
        source=FieldSource.ACCOUNT_DEFAULT,
    )
    result = validate_product_fields(
        fields,
        ["shippingTemplate", "shippingTemplate.shippingTemplateId"],
    )
    assert result.ready_to_publish is True
    assert result.missing_fields == []


def test_ai_source_requires_confirmation_even_without_client_flag() -> None:
    fields = trusted_fields()
    fields["title"] = DraftField(
        value="Portable desk lamp",
        source=FieldSource.AI_GENERATED,
        requires_confirmation=False,
    )
    result = validate_product_fields(fields, [])
    assert result.ready_to_publish is False
    assert result.confirmation_fields == ["title"]


def test_confirmed_ai_candidate_becomes_trusted_content() -> None:
    fields = trusted_fields()
    fields["title"] = DraftField(
        value="Portable desk lamp",
        source=FieldSource.USER_CONFIRMED,
    )
    result = validate_product_fields(fields, [])
    assert result.ready_to_publish is True


def test_store_default_can_fill_allowed_schema_field() -> None:
    fields = trusted_fields()
    result = validate_product_fields(
        fields,
        ["priceUnit"],
        account_defaults={
            "price_unit": DraftField(
                value="100000015",
                source=FieldSource.ACCOUNT_DEFAULT,
            )
        },
    )
    assert result.ready_to_publish is True
    assert result.invalid_default_fields == []


def test_store_default_cannot_supply_per_product_price() -> None:
    fields = trusted_fields()
    fields.pop("price")
    result = validate_product_fields(
        fields,
        ["price"],
        account_defaults={
            "price": DraftField(value="9.99", source=FieldSource.ACCOUNT_DEFAULT)
        },
    )
    assert result.ready_to_publish is False
    assert result.missing_fields == ["price"]
    assert result.invalid_default_fields == ["price"]


@pytest.mark.parametrize(
    "field_name",
    [
        "productTitle",
        "searchKeyword",
        "sellingPoint",
        "productDescription",
        "icbuCatProp.visibleColor",
        "icbuCatProp.pattern",
        "icbuCatProp.shape",
        "icbuCatProp.application",
    ],
)
def test_only_marketing_and_visible_fields_are_ai_candidates(field_name: str) -> None:
    responsibility, _, _, _ = schema_field_responsibility(field_name)
    assert responsibility == "ai_candidate"


@pytest.mark.parametrize(
    "field_name",
    [
        "brandName",
        "modelNumber",
        "productMaterial",
        "unitPrice",
        "minOrderQuantity",
        "availableStock",
        "netWeight",
        "grossWeight",
        "packageSize",
        "productionLeadTime",
        "placeOfOrigin",
        "hsCode",
        "certificationName",
        "paymentTerms",
        "incoterm",
        "portOfLoading",
    ],
)
def test_trade_supply_chain_and_compliance_fields_are_business_facts(
    field_name: str,
) -> None:
    responsibility, _, _, _ = schema_field_responsibility(field_name)
    assert responsibility == "business_system"


@pytest.mark.parametrize(
    "field_name",
    [
        "categorySpecificDeclaration",
        "patentDescription",
        "trademarkAuthorization",
        "productRightsClaim",
        "warrantyTerms",
        "dangerousGoodsDeclaration",
        "companyImage.images.imageURL",
        "imageVideo",
        "designAndSampleService",
    ],
)
def test_declarations_rights_and_commitments_require_merchant_input(
    field_name: str,
) -> None:
    responsibility, _, reason, _ = schema_field_responsibility(field_name)
    assert responsibility == "merchant"
    assert "必须由客户" in reason


@pytest.mark.parametrize(
    "field_name",
    ["currency", "fobUnitType", "warehouseId", "shippingTemplateId"],
)
def test_only_confirmed_store_configuration_uses_defaults(field_name: str) -> None:
    responsibility, _, _, _ = schema_field_responsibility(field_name)
    assert responsibility == "store_default"
