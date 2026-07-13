from backend.app.models import (
    ParsedSchemaField,
    SchemaFieldGuidance,
    SchemaGuidanceResult,
    SchemaOption,
    SchemaRule,
)
from backend.app.services.field_policy import is_manual_fact_field
from backend.app.services.schema_rules import parse_schema_data

MAX_OPTIONS_PER_FIELD = 40
SKIPPED_TYPES = {"label", "hidden"}


def build_schema_guidance(
    schema_data: dict[str, object] | str | None,
) -> SchemaGuidanceResult:
    if schema_data is None:
        return SchemaGuidanceResult(
            ai_fillable_fields=[],
            manual_fact_fields=[],
            required_field_ids=[],
        )
    parsed = parse_schema_data(schema_data)
    ai_fillable: list[SchemaFieldGuidance] = []
    manual: list[SchemaFieldGuidance] = []
    for field in parsed.fields:
        _collect(field, ai_fillable, manual)
    return SchemaGuidanceResult(
        ai_fillable_fields=ai_fillable,
        manual_fact_fields=manual,
        required_field_ids=parsed.required_field_ids,
    )


def _collect(
    field: ParsedSchemaField,
    ai_fillable: list[SchemaFieldGuidance],
    manual: list[SchemaFieldGuidance],
) -> None:
    key = _field_key(field)
    describable = (
        bool(key)
        and not field.disabled
        and not field.read_only
        and (field.type or "") not in SKIPPED_TYPES
        and (bool(field.options) or not field.children)
    )
    if describable:
        guidance = SchemaFieldGuidance(
            field=key,
            name=field.name,
            type=field.type,
            required=field.required,
            manual_fact=(
                is_manual_fact_field(key)
                or is_manual_fact_field(field.name or "")
            ),
            max_length=_max_length(field.rules),
            tip=_tip(field.rules),
            options=field.options[:MAX_OPTIONS_PER_FIELD],
        )
        if guidance.manual_fact:
            manual.append(guidance)
        else:
            ai_fillable.append(guidance)
    for child in field.children:
        _collect(child, ai_fillable, manual)


def _max_length(rules: list[SchemaRule]) -> int | None:
    for rule in rules:
        if rule.name == "maxLengthRule" and rule.value:
            digits = "".join(char for char in rule.value if char.isdigit())
            if digits:
                return int(digits)
    return None


def _tip(rules: list[SchemaRule]) -> str | None:
    for rule in rules:
        if rule.name == "tipRule" and rule.value:
            return rule.value
    return None


def render_guidance_prompt(guidance: SchemaGuidanceResult) -> str:
    if not guidance.ai_fillable_fields and not guidance.manual_fact_fields:
        return ""
    lines: list[str] = [
        "Official Alibaba category publishing schema for this product. "
        "Only fill the AI-fillable fields below, using the field id as the key in "
        "observed_fields or generated_fields. For fields that list allowed options, "
        "you MUST return one of the given option values (not the display name) and only "
        "when the image evidence clearly supports it; otherwise omit the field. Respect "
        "max length limits and any compliance tip. Required fields are marked [required]."
    ]
    if guidance.ai_fillable_fields:
        lines.append("AI-fillable fields:")
        for item in guidance.ai_fillable_fields:
            lines.append(_render_field(item))
    if guidance.manual_fact_fields:
        manual_names = ", ".join(
            item.field for item in guidance.manual_fact_fields
        )
        lines.append(
            "Never fill these human/business fact fields (a person must supply them): "
            f"{manual_names}."
        )
    return "\n".join(lines)


def _render_field(item: SchemaFieldGuidance) -> str:
    parts = [f"- {item.field}"]
    if item.name:
        parts.append(f'"{item.name}"')
    parts.append(f"({item.type or 'input'})")
    if item.required:
        parts.append("[required]")
    if item.max_length:
        parts.append(f"[max {item.max_length}]")
    if item.options:
        parts.append("options=" + _render_options(item.options))
    if item.tip:
        parts.append(f"tip: {item.tip}")
    return " ".join(parts)


def _render_options(options: list[SchemaOption]) -> str:
    rendered = ", ".join(
        f"{option.display_name or option.value}={option.value}" for option in options
    )
    return f"[{rendered}]"


def _field_key(field: ParsedSchemaField) -> str:
    return ".".join(part for part in field.path if part) or field.id
