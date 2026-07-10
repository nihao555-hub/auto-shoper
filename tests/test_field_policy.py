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
