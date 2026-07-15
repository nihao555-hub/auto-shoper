from typing import Literal

from backend.app.models import (
    FieldSource,
    ParsedSchemaField,
    SchemaFieldGuidance,
    SchemaGuidanceResult,
    SchemaOption,
    SchemaRule,
)
from backend.app.services.field_policy import schema_field_responsibility
from backend.app.services.schema_rules import parse_schema_data

MAX_PROMPT_OPTIONS_PER_FIELD = 40
SKIPPED_TYPES = {"label", "hidden"}
CHOICE_TYPES = {"singleCheck", "multiCheck"}
SUPPORTED_TYPES = {
    "input",
    "multiInput",
    "singleCheck",
    "multiCheck",
    "complex",
    "multiComplex",
}
SUPPORTED_VALUE_TYPES = {
    None,
    "text",
    "double",
    "decimal",
    "integer",
    "date",
    "long",
    "url",
    "textarea",
    "html",
}


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
    parents: list[ParsedSchemaField] | None = None,
) -> None:
    parent_fields = parents or []
    key = _field_key(field)
    describable = (
        bool(key)
        and not field.disabled
        and not field.read_only
        and (field.type or "") not in SKIPPED_TYPES
        and (bool(field.options) or not field.children)
    )
    if describable:
        async_query_method = _rule_value(field.rules, "asyncQueryRule")
        responsibility, label, reason, allowed_sources = _responsibility(key, field.name or "")
        supported = (
            (field.type or "input") in SUPPORTED_TYPES
            and field.value_type in SUPPORTED_VALUE_TYPES
        )
        support_message = None
        if not supported:
            field_signature = f"{field.type or 'input'} / {field.value_type or 'text'}"
            support_message = f"Alibaba 返回了暂未支持的字段类型：{field_signature}"
        if (
            responsibility == "ai_candidate"
            and field.type in CHOICE_TYPES
            and not field.options
            and async_query_method is None
        ):
            responsibility, label, reason, allowed_sources = _unsupported_choice_responsibility()
        if field.type in CHOICE_TYPES and not field.options and async_query_method is None:
            supported = False
            support_message = "Alibaba 未返回该选择字段的可提交选项，禁止按文本猜测填写"
        guidance = SchemaFieldGuidance(
            field=key,
            name=field.name,
            type=field.type,
            required=field.required,
            manual_fact=responsibility != "ai_candidate",
            responsibility=responsibility,
            responsibility_label=label,
            responsibility_reason=reason,
            allowed_sources=allowed_sources,
            async_options=async_query_method is not None,
            async_query_method=async_query_method,
            value_type=field.value_type,
            max_length=_max_length(field.rules),
            min_length=_integer_rule(field.rules, "minLengthRule"),
            min_value=_rule_value(field.rules, "minValueRule"),
            max_value=_rule_value(field.rules, "maxValueRule"),
            min_input_num=_integer_rule(field.rules, "minInputNumRule"),
            max_input_num=_integer_rule(field.rules, "maxInputNumRule"),
            pattern=_rule_value(field.rules, "regxRule") or _rule_value(field.rules, "regexRule"),
            value_attributes=_rule_values(field.rules, "valueAttributeRule"),
            conditional_disable=field.conditional_disable,
            supported=supported,
            support_message=support_message,
            tip=_tip(field.rules),
            options=field.options,
            parent_path=".".join(field.path[:-1]) or None,
            repeatable_group=next(
                (
                    ".".join(parent.path)
                    for parent in reversed(parent_fields)
                    if parent.type == "multiComplex"
                ),
                None,
            ),
        )
        if guidance.responsibility == "ai_candidate":
            ai_fillable.append(guidance)
        else:
            manual.append(guidance)
    for child in field.children:
        _collect(child, ai_fillable, manual, [*parent_fields, field])


def _responsibility(
    key: str,
    name: str,
) -> tuple[
    Literal["ai_candidate", "merchant", "business_system", "store_default"],
    str,
    str,
    list[FieldSource],
]:
    return schema_field_responsibility(f"{key}.{name}")


def _unsupported_choice_responsibility() -> tuple[
    Literal["merchant"],
    str,
    str,
    list[FieldSource],
]:
    return (
        "merchant",
        "客户填写",
        "Alibaba 选择字段未返回可安全提交的选项，必须由客户选择或等待选项加载",
        [
            FieldSource.USER_PROVIDED,
            FieldSource.USER_CONFIRMED,
            FieldSource.BUSINESS_SYSTEM,
        ],
    )


def _max_length(rules: list[SchemaRule]) -> int | None:
    for rule in rules:
        if rule.name == "maxLengthRule" and rule.value:
            digits = "".join(char for char in rule.value if char.isdigit())
            if digits:
                return int(digits)
    return None


def _integer_rule(rules: list[SchemaRule], name: str) -> int | None:
    value = _rule_value(rules, name)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _rule_values(rules: list[SchemaRule], name: str) -> list[str]:
    return [rule.value for rule in rules if rule.name == name and rule.value]


def _tip(rules: list[SchemaRule]) -> str | None:
    for rule in rules:
        if rule.name == "tipRule" and rule.value:
            return rule.value
    return None


def _rule_value(rules: list[SchemaRule], name: str) -> str | None:
    for rule in rules:
        if rule.name == name:
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
        manual_names = ", ".join(item.field for item in guidance.manual_fact_fields)
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
        if len(item.options) <= MAX_PROMPT_OPTIONS_PER_FIELD:
            parts.append("options=" + _render_options(item.options))
        else:
            parts.append(
                f"[{len(item.options)} allowed options are available in the UI; "
                "omit this field from AI output]"
            )
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
