from xml.etree import ElementTree

from backend.app.models import (
    ParsedSchemaField,
    SchemaDependencyExpression,
    SchemaDependencyGroup,
    SchemaOption,
    SchemaParseResult,
    SchemaRule,
)
from backend.app.services.field_policy import is_manual_fact_field


class SchemaParseError(ValueError):
    pass


# Alibaba exposes all inquiry-price components in the same Schema. Their child
# fields are required only after the merchant selects the corresponding
# ``scPrice`` mode; they are not global requirements.
PRICE_MODE_COMPONENT_ROOTS = {"fob", "ladderPrice"}


def parse_schema_data(schema_data: dict[str, object] | str) -> SchemaParseResult:
    schema_xml = extract_schema_xml(schema_data)
    try:
        root = ElementTree.fromstring(schema_xml)
    except ElementTree.ParseError as exc:
        raise SchemaParseError(f"Invalid Alibaba Schema XML: {exc}") from exc

    fields = [
        _parse_field(field, [])
        for field in _field_children(root)
    ]
    required = sorted(_required_field_ids(fields))
    manual = sorted(_manual_field_ids(fields))
    return SchemaParseResult(
        fields=fields,
        required_field_ids=required,
        manual_confirmation_field_ids=manual,
    )


def merge_schema_required_fields(
    schema_required_fields: list[str], schema_data: dict[str, object] | str | None
) -> list[str]:
    if schema_data is None:
        return sorted(set(schema_required_fields))
    parsed = parse_schema_data(schema_data)
    return sorted(set(schema_required_fields) | set(parsed.required_field_ids))


def manual_schema_fields(schema_data: dict[str, object] | str | None) -> list[str]:
    if schema_data is None:
        return []
    return parse_schema_data(schema_data).manual_confirmation_field_ids


def extract_schema_xml(schema_data: dict[str, object] | str) -> str:
    if isinstance(schema_data, str):
        stripped = schema_data.strip()
        if stripped.startswith("<"):
            return stripped
        raise SchemaParseError("schema_data string must contain Alibaba Schema XML")

    candidates = _schema_xml_candidates(schema_data)
    for candidate in candidates:
        stripped = candidate.strip()
        if stripped.startswith("<") and "<field" in stripped:
            return stripped
    raise SchemaParseError("schema_data does not contain Alibaba Schema XML")


def _schema_xml_candidates(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        result: list[str] = []
        for item in value.values():
            result.extend(_schema_xml_candidates(item))
        return result
    if isinstance(value, list):
        result = []
        for item in value:
            result.extend(_schema_xml_candidates(item))
        return result
    return []


def _parse_field(element: ElementTree.Element, parent_path: list[str]) -> ParsedSchemaField:
    field_id = element.attrib.get("id", "")
    path = [*parent_path, field_id] if field_id else parent_path
    rules = _rules(element)
    conditional_disable = _disable_dependencies(element)
    disabled = _rule_value(rules, "disableRule") == "true" and not conditional_disable
    read_only = _rule_value(rules, "readOnlyRule") == "true"
    value_type = _rule_value(rules, "valueTypeRule")
    return ParsedSchemaField(
        id=field_id,
        name=element.attrib.get("name"),
        type=element.attrib.get("type"),
        path=path,
        required=_rule_value(rules, "requiredRule") == "true",
        disabled=disabled,
        read_only=read_only,
        value_type=value_type,
        conditional_disable=conditional_disable,
        rules=rules,
        options=_options(element),
        children=[_parse_field(child, path) for child in _nested_field_children(element)],
    )


def _rules(element: ElementTree.Element) -> list[SchemaRule]:
    result: list[SchemaRule] = []
    for rules_element in _children_named(element, "rules"):
        for rule in _children_named(rules_element, "rule"):
            name = rule.attrib.get("name")
            if name:
                result.append(
                    SchemaRule(
                        name=name,
                        value=rule.attrib.get("value"),
                        ex_property=rule.attrib.get("exProperty"),
                        unit=rule.attrib.get("unit"),
                    )
                )
    return result


def _options(element: ElementTree.Element) -> list[SchemaOption]:
    result: list[SchemaOption] = []
    for options_element in _children_named(element, "options"):
        for option in _children_named(options_element, "option"):
            value = option.attrib.get("value")
            if value is not None:
                result.append(
                    SchemaOption(
                        display_name=option.attrib.get("displayName"),
                        value=value,
                        valid=option.attrib.get("valid", "true").lower() != "false",
                        attributes={
                            key: item
                            for key, item in option.attrib.items()
                            if key not in {"displayName", "value", "valid"}
                        },
                    )
                )
    return result


def _disable_dependencies(element: ElementTree.Element) -> list[SchemaDependencyGroup]:
    result: list[SchemaDependencyGroup] = []
    for rules_element in _children_named(element, "rules"):
        for rule in _children_named(rules_element, "rule"):
            if rule.attrib.get("name") != "disableRule" or rule.attrib.get("value") != "true":
                continue
            for group in _children_named(rule, "depend-group"):
                expressions = [
                    SchemaDependencyExpression(
                        field_id=expression.attrib.get("fieldId", ""),
                        value=expression.attrib.get("value"),
                        symbol=expression.attrib.get("symbol", "=="),
                    )
                    for expression in _children_named(group, "depend-express")
                    if expression.attrib.get("fieldId")
                ]
                if expressions:
                    result.append(
                        SchemaDependencyGroup(
                            operator="or" if group.attrib.get("operator") == "or" else "and",
                            expressions=expressions,
                        )
                    )
    return result


def _field_children(element: ElementTree.Element) -> list[ElementTree.Element]:
    direct = _children_named(element, "field")
    if direct:
        return direct
    result: list[ElementTree.Element] = []
    for child in list(element):
        if _local_name(child.tag) in {"fields", "schema", "result"}:
            result.extend(_field_children(child))
    return result


def _nested_field_children(element: ElementTree.Element) -> list[ElementTree.Element]:
    result: list[ElementTree.Element] = []
    for fields_element in _children_named(element, "fields"):
        result.extend(_children_named(fields_element, "field"))
    return result


def _children_named(element: ElementTree.Element, name: str) -> list[ElementTree.Element]:
    return [child for child in list(element) if _local_name(child.tag) == name]


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _rule_value(rules: list[SchemaRule], name: str) -> str | None:
    for rule in rules:
        if rule.name == name:
            return rule.value
    return None


def _flatten_field_ids(
    fields: list[ParsedSchemaField],
    *,
    only_required: bool,
) -> set[str]:
    result: set[str] = set()
    for field in fields:
        if not field.disabled and (field.required or not only_required):
            result.add(_field_key(field))
        result.update(_flatten_field_ids(field.children, only_required=only_required))
    return result


def _manual_field_ids(fields: list[ParsedSchemaField]) -> set[str]:
    result: set[str] = set()
    for field in fields:
        key = _field_key(field)
        if is_manual_fact_field(key) or is_manual_fact_field(field.name or ""):
            result.add(key)
        result.update(_manual_field_ids(field.children))
    return result


def _required_field_ids(
    fields: list[ParsedSchemaField],
    *,
    inspect_children: bool = True,
) -> set[str]:
    result: set[str] = set()
    for field in fields:
        if field.disabled or field.read_only:
            continue
        if (
            len(field.path) > 1
            and field.path[0] in PRICE_MODE_COMPONENT_ROOTS
        ):
            continue
        if field.required:
            result.add(_field_key(field))
        if inspect_children and field.type == "complex":
            for child in field.children:
                if (
                    len(child.path) > 1
                    and child.path[0] in PRICE_MODE_COMPONENT_ROOTS
                ):
                    continue
                if child.disabled or child.read_only or not child.required:
                    continue
                result.add(_field_key(child))
                if child.type == "complex":
                    result.update(_required_field_ids(child.children))
    return result


def _field_key(field: ParsedSchemaField) -> str:
    return ".".join(part for part in field.path if part) or field.id
