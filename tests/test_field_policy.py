from backend.app.models import DraftField, FieldSource
from backend.app.services.field_policy import MANUAL_FIELD_NAMES, validate_product_fields


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
