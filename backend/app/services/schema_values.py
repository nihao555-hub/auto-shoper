import re
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree

from backend.app.models import SchemaBuildResult, SchemaValidationIssue
from backend.app.services.schema_rules import SchemaParseError, extract_schema_xml

_VALUE_TAGS = {"value", "values", "complex-value", "complex-values"}
_MULTI_TYPES = {"multiInput", "multiCheck"}
_COMPLEX_TYPES = {"complex", "multiComplex"}


def build_schema_xml(
    schema_data: dict[str, object] | str,
    values: dict[str, object],
) -> SchemaBuildResult:
    schema_xml = extract_schema_xml(schema_data)
    try:
        root = ElementTree.fromstring(schema_xml)
    except ElementTree.ParseError as exc:
        raise SchemaParseError(f"Invalid Alibaba Schema XML: {exc}") from exc

    errors: list[SchemaValidationIssue] = []
    warnings: list[SchemaValidationIssue] = []
    fields = _field_children(root)
    field_options = _field_option_values(fields)
    field_by_id = {
        field.attrib["id"]: field for field in fields if field.attrib.get("id")
    }
    context_values = dict(values)

    for field_id in values:
        if field_id not in field_by_id:
            errors.append(
                _issue(field_id, "unknownField", "Field is not present in this category Schema")
            )

    for field in fields:
        field_id = field.attrib.get("id", "")
        supplied = field_id in values
        value = values.get(field_id)
        _validate_and_fill(
            field,
            value,
            supplied=supplied,
            path=[field_id],
            errors=errors,
            warnings=warnings,
            top_level=True,
            context_values=context_values,
            field_options=field_options,
        )

    return SchemaBuildResult(
        xml=ElementTree.tostring(root, encoding="unicode"),
        ready_to_submit=not errors,
        errors=errors,
        warnings=warnings,
    )


def validate_filled_schema_xml(
    schema_data: dict[str, object] | str,
) -> SchemaBuildResult:
    schema_xml = extract_schema_xml(schema_data)
    try:
        root = ElementTree.fromstring(schema_xml)
    except ElementTree.ParseError as exc:
        raise SchemaParseError(f"Invalid Alibaba Schema XML: {exc}") from exc
    values: dict[str, object] = {}
    for field in _field_children(root):
        field_id = field.attrib.get("id")
        value = _extract_value(field)
        if field_id and value is not None:
            values[field_id] = value
    return build_schema_xml(schema_data, values)


def _validate_and_fill(
    field: ElementTree.Element,
    value: object,
    *,
    supplied: bool,
    path: list[str],
    errors: list[SchemaValidationIssue],
    warnings: list[SchemaValidationIssue],
    top_level: bool = False,
    context_values: dict[str, object] | None = None,
    field_options: dict[str, set[str]] | None = None,
) -> None:
    field_key = ".".join(part for part in path if part)
    field_type = field.attrib.get("type", "input")
    rules = _rules(field)
    value = _with_option_attributes(field, value, rules)

    if _rule_disables_field(
        field,
        rules,
        context_values or {},
        field_options or {},
    ):
        if supplied:
            errors.append(_issue(field_key, "disableRule", "Disabled field must not be submitted"))
        return
    if _rule_is_true(rules, "readOnlyRule"):
        if supplied:
            errors.append(
                _issue(field_key, "readOnlyRule", "Read-only field must not be submitted")
            )
        return

    if _rule_is_true(rules, "requiredRule") and _is_empty(value):
        errors.append(_issue(field_key, "requiredRule", "Required field is missing"))
        return

    if field_type in _COMPLEX_TYPES:
        _validate_and_fill_complex(
            field,
            value,
            supplied=supplied,
            path=path,
            errors=errors,
            warnings=warnings,
            top_level=top_level,
            context_values=context_values or {},
            field_options=field_options or {},
        )
        return

    if not supplied or _is_empty(value):
        return

    _validate_scalar_or_multi(field, value, field_key, rules, errors, warnings)
    if not any(issue.field == field_key for issue in errors):
        _fill_scalar_or_multi(field, value)


def _validate_and_fill_complex(
    field: ElementTree.Element,
    value: object,
    *,
    supplied: bool,
    path: list[str],
    errors: list[SchemaValidationIssue],
    warnings: list[SchemaValidationIssue],
    top_level: bool,
    context_values: dict[str, object],
    field_options: dict[str, set[str]],
) -> None:
    field_key = ".".join(part for part in path if part)
    field_type = field.attrib.get("type")
    children = _nested_field_children(field)
    if field_type == "multiComplex":
        if not supplied or _is_empty(value):
            return
        if not isinstance(value, list):
            errors.append(_issue(field_key, "valueTypeRule", "Expected a list of objects"))
            return
        _validate_item_count(field, value, field_key, errors)
        instances: list[ElementTree.Element] = []
        for index, item in enumerate(value):
            if not isinstance(item, dict):
                errors.append(
                    _issue(f"{field_key}[{index}]", "valueTypeRule", "Expected an object")
                )
                continue
            instances.append(
                _build_complex_instance(
                    children,
                    item,
                    [*path, f"[{index}]"],
                    errors,
                    warnings,
                    context_values,
                    field_options,
                )
            )
        if not any(issue.field == field_key for issue in errors):
            _replace_complex_values(field, instances, "complex-values")
        return

    if supplied and not isinstance(value, dict):
        errors.append(_issue(field_key, "valueTypeRule", "Expected an object"))
        return

    child_values = value if isinstance(value, dict) else {}
    must_validate_children = supplied or top_level
    if not must_validate_children:
        return
    instance = _build_complex_instance(
        children,
        child_values,
        path,
        errors,
        warnings,
        context_values,
        field_options,
    )
    if supplied and not any(
        issue.field == field_key or issue.field.startswith(f"{field_key}.")
        for issue in errors
    ):
        _replace_complex_values(field, [instance], "complex-value")


def _build_complex_instance(
    children: list[ElementTree.Element],
    values: dict[object, object],
    path: list[str],
    errors: list[SchemaValidationIssue],
    warnings: list[SchemaValidationIssue],
    context_values: dict[str, object],
    field_options: dict[str, set[str]],
) -> ElementTree.Element:
    instance = ElementTree.Element("instance")
    children_by_id = {
        child.attrib["id"]: child for child in children if child.attrib.get("id")
    }
    for raw_key in values:
        key = str(raw_key)
        if key not in children_by_id:
            field_key = ".".join([*path, key])
            errors.append(
                _issue(field_key, "unknownField", "Field is not present in this complex field")
            )

    for child in children:
        child_id = child.attrib.get("id", "")
        supplied = child_id in values
        value = values.get(child_id)
        child_context = {**context_values, **{str(key): item for key, item in values.items()}}
        working_field = deepcopy(child)
        output = ElementTree.Element("field", working_field.attrib)
        _validate_and_fill(
            working_field,
            value,
            supplied=supplied,
            path=[*path, child_id],
            errors=errors,
            warnings=warnings,
            context_values=child_context,
            field_options=field_options,
        )
        _copy_direct_values(working_field, output)
        instance.append(output)
    return instance


def _validate_scalar_or_multi(
    field: ElementTree.Element,
    value: object,
    field_key: str,
    rules: dict[str, list[dict[str, str]]],
    errors: list[SchemaValidationIssue],
    warnings: list[SchemaValidationIssue],
) -> None:
    field_type = field.attrib.get("type")
    values = value if field_type in _MULTI_TYPES else [value]
    if field_type in _MULTI_TYPES and not isinstance(value, list):
        errors.append(_issue(field_key, "valueTypeRule", "Expected a list"))
        return
    if not isinstance(values, list):
        values = [values]

    _validate_item_count(field, values, field_key, errors)
    option_values = _option_values(field)
    required_attributes = {
        rule.get("value", "")
        for rule in rules.get("valueAttributeRule", [])
        if rule.get("value")
    }

    for item in values:
        text, attributes = _value_parts(item)
        if text is None:
            errors.append(_issue(field_key, "valueTypeRule", "Value must be scalar"))
            continue
        custom_input = (
            "inputValue" in required_attributes
            and bool(attributes.get("inputValue", "").strip())
            and text.startswith("-")
            and text[1:].isdigit()
        )
        if option_values and text not in option_values and not custom_input:
            errors.append(_issue(field_key, "optionRule", f"Unsupported option: {text}"))
        missing_attributes = sorted(required_attributes - set(attributes))
        if missing_attributes:
            errors.append(
                _issue(
                    field_key,
                    "valueAttributeRule",
                    f"Missing value attributes: {', '.join(missing_attributes)}",
                )
            )
        _validate_text_rules(
            text,
            field_key,
            rules,
            errors,
            include_input_num_length=field_type not in _MULTI_TYPES,
        )

    if "asyncQueryRule" in rules:
        warnings.append(
            _issue(
                field_key,
                "asyncQueryRule",
                "Dynamic option must be verified with Alibaba before submission",
            )
        )


def _validate_text_rules(
    text: str,
    field_key: str,
    rules: dict[str, list[dict[str, str]]],
    errors: list[SchemaValidationIssue],
    *,
    include_input_num_length: bool,
) -> None:
    for rule in rules.get("valueTypeRule", []):
        value_type = rule.get("value")
        if value_type in {"integer", "long"}:
            try:
                int(text)
            except ValueError:
                errors.append(_issue(field_key, "valueTypeRule", "Expected an integer"))
        elif value_type in {"double", "decimal"}:
            try:
                Decimal(text)
            except InvalidOperation:
                errors.append(_issue(field_key, "valueTypeRule", "Expected a number"))

    length_rules = [
        ("maxLengthRule", "maximum"),
        ("minLengthRule", "minimum"),
    ]
    if include_input_num_length:
        length_rules.append(("maxInputNumRule", "maximum"))
    for rule_name, comparison in length_rules:
        for rule in rules.get(rule_name, []):
            limit = _integer(rule.get("value"))
            if limit is None:
                continue
            actual = len(text.encode()) if rule.get("unit") == "byte" else len(text)
            invalid = actual > limit if comparison == "maximum" else actual < limit
            if invalid:
                errors.append(
                    _issue(
                        field_key,
                        rule_name,
                        f"Length {actual} violates {comparison} {limit}",
                    )
                )

    for rule in [*rules.get("regxRule", []), *rules.get("regexRule", [])]:
        pattern = rule.get("value")
        if not pattern:
            continue
        try:
            matched = re.fullmatch(pattern, text) is not None
        except re.error:
            continue
        should_match = rule.get("exProperty") != "not include"
        if matched != should_match:
            errors.append(_issue(field_key, "regxRule", "Value does not satisfy pattern rule"))

    try:
        numeric_value = Decimal(text)
    except InvalidOperation:
        return
    for rule_name, is_maximum in (
        ("maxValueRule", True),
        ("minValueRule", False),
        ("maxDecimalDigitsRule", True),
        ("minDecimalDigitsRule", False),
    ):
        for rule in rules.get(rule_name, []):
            raw_limit = rule.get("value")
            if raw_limit is None:
                continue
            try:
                decimal_limit = Decimal(raw_limit)
            except InvalidOperation:
                continue
            inclusive = rule.get("exProperty") != "not include"
            invalid = (
                numeric_value > decimal_limit if inclusive and is_maximum else
                numeric_value >= decimal_limit if is_maximum else
                numeric_value < decimal_limit if inclusive else
                numeric_value <= decimal_limit
            )
            if invalid:
                boundary = "inclusive" if inclusive else "exclusive"
                errors.append(
                    _issue(
                        field_key,
                        rule_name,
                        f"Value violates {boundary} limit {decimal_limit}",
                    )
                )


def _validate_item_count(
    field: ElementTree.Element,
    values: list[object],
    field_key: str,
    errors: list[SchemaValidationIssue],
) -> None:
    rules = _rules(field)
    for rule_name, is_maximum in (
        ("maxItemsRule", True),
        ("maxInputNumRule", True),
        ("minInputNumRule", False),
    ):
        for rule in rules.get(rule_name, []):
            limit = _integer(rule.get("value"))
            if limit is None:
                continue
            invalid = len(values) > limit if is_maximum else len(values) < limit
            if invalid:
                errors.append(
                    _issue(
                        field_key,
                        rule_name,
                        f"Item count {len(values)} violates limit {limit}",
                    )
                )


def _fill_scalar_or_multi(field: ElementTree.Element, value: object) -> None:
    _remove_direct_values(field)
    if field.attrib.get("type") in _MULTI_TYPES:
        container = ElementTree.Element("values")
        values = value if isinstance(value, list) else []
        for item in values:
            text, attributes = _value_parts(item)
            element = ElementTree.SubElement(container, "value", attributes)
            element.text = text
        _insert_value(field, container)
        return
    text, attributes = _value_parts(value)
    element = ElementTree.Element("value", attributes)
    element.text = text
    _insert_value(field, element)


def _replace_complex_values(
    field: ElementTree.Element,
    instances: list[ElementTree.Element],
    tag: str,
) -> None:
    _remove_direct_values(field)
    for instance in instances:
        container = ElementTree.Element(tag)
        container.extend(list(instance))
        _insert_value(field, container)


def _copy_direct_values(source: ElementTree.Element, target: ElementTree.Element) -> None:
    for child in list(source):
        if _local_name(child.tag) in _VALUE_TAGS:
            target.append(child)


def _remove_direct_values(field: ElementTree.Element) -> None:
    for child in list(field):
        if _local_name(child.tag) in _VALUE_TAGS:
            field.remove(child)


def _insert_value(field: ElementTree.Element, value: ElementTree.Element) -> None:
    for index, child in enumerate(list(field)):
        if _local_name(child.tag) in {"rules", "options", "fields"}:
            field.insert(index, value)
            return
    field.append(value)


def _rules(field: ElementTree.Element) -> dict[str, list[dict[str, str]]]:
    result: dict[str, list[dict[str, str]]] = {}
    for rules_element in _children_named(field, "rules"):
        for rule in _children_named(rules_element, "rule"):
            name = rule.attrib.get("name")
            if name:
                result.setdefault(name, []).append(dict(rule.attrib))
    return result


def _rule_is_true(rules: dict[str, list[dict[str, str]]], name: str) -> bool:
    return any(rule.get("value") == "true" for rule in rules.get(name, []))


def _rule_disables_field(
    field: ElementTree.Element,
    rules: dict[str, list[dict[str, str]]],
    values: dict[str, object],
    field_options: dict[str, set[str]],
) -> bool:
    if not _rule_is_true(rules, "disableRule"):
        return False
    groups: list[ElementTree.Element] = []
    for rules_element in _children_named(field, "rules"):
        for rule in _children_named(rules_element, "rule"):
            if rule.attrib.get("name") == "disableRule" and rule.attrib.get("value") == "true":
                groups.extend(_children_named(rule, "depend-group"))
    if not groups:
        return True
    return any(
        _dependency_group_matches(group, values, field_options)
        for group in groups
    )


def _dependency_group_matches(
    group: ElementTree.Element,
    values: dict[str, object],
    field_options: dict[str, set[str]],
) -> bool:
    matches = [
        _dependency_matches(expression, values, field_options)
        for expression in _children_named(group, "depend-express")
    ]
    if not matches:
        return False
    return any(matches) if group.attrib.get("operator") == "or" else all(matches)


def _dependency_matches(
    expression: ElementTree.Element,
    values: dict[str, object],
    field_options: dict[str, set[str]],
) -> bool:
    field_id = expression.attrib.get("fieldId", "")
    actual = values.get(field_id)
    expected = expression.attrib.get("value", "")
    symbol = expression.attrib.get("symbol", "==")
    comparable = actual.get("value") if isinstance(actual, dict) else actual
    if symbol == "is null":
        return _is_empty(comparable)
    if symbol in {"contains", "not contains"}:
        contains = expected in comparable if isinstance(comparable, str | list) else False
        return contains if symbol == "contains" else not contains
    if symbol in {"==", "!="}:
        equal = str(comparable) == expected
        return equal if symbol == "==" else not equal
    if symbol in {">", "<", ">=", "<="}:
        try:
            left = Decimal(str(comparable))
            right = Decimal(expected)
        except InvalidOperation:
            return False
        return {
            ">": left > right,
            "<": left < right,
            ">=": left >= right,
            "<=": left <= right,
        }[symbol]
    if symbol in {
        "this field's value in fieldOptions",
        "this field’s value in fieldOptions",
        "this field's value not in fieldOptions",
        "this field’s value not in fieldOptions",
    }:
        allowed = field_options.get(field_id, set())
        actual_values = comparable if isinstance(comparable, list) else [comparable]
        in_options = bool(actual_values) and all(
            not _is_empty(item) and str(item) in allowed
            for item in actual_values
        )
        return not in_options if " not in " in symbol else in_options
    return False


def _field_option_values(
    fields: list[ElementTree.Element],
) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for field in fields:
        field_id = field.attrib.get("id")
        if field_id:
            result.setdefault(field_id, set()).update(_option_values(field))
        nested = _field_option_values(_nested_field_children(field))
        for nested_id, values in nested.items():
            result.setdefault(nested_id, set()).update(values)
    return result


def _option_values(field: ElementTree.Element) -> set[str]:
    result: set[str] = set()
    for options in _children_named(field, "options"):
        for option in _children_named(options, "option"):
            value = option.attrib.get("value")
            if value is not None:
                result.add(value)
    return result


def _with_option_attributes(
    field: ElementTree.Element,
    value: object,
    rules: dict[str, list[dict[str, str]]],
) -> object:
    required_attributes = {
        rule.get("value", "")
        for rule in rules.get("valueAttributeRule", [])
        if rule.get("value")
    }
    option_labels = _option_labels(field)
    if not required_attributes or not option_labels:
        return value
    if field.attrib.get("type") in _MULTI_TYPES and isinstance(value, list):
        return [
            _with_required_attributes(item, option_labels, required_attributes)
            for item in value
        ]
    return _with_required_attributes(value, option_labels, required_attributes)


def _with_required_attributes(
    value: object,
    option_labels: dict[str, str],
    required_attributes: set[str],
) -> object:
    text, attributes = _value_parts(value)
    if text is None or text not in option_labels:
        return value
    completed = dict(attributes)
    for attribute in required_attributes:
        completed.setdefault(attribute, option_labels[text] if attribute == "text" else "")
    return {"value": text, "attributes": completed}


def _option_labels(field: ElementTree.Element) -> dict[str, str]:
    result: dict[str, str] = {}
    for options in _children_named(field, "options"):
        for option in _children_named(options, "option"):
            value = option.attrib.get("value")
            if value is not None:
                result[value] = option.attrib.get("displayName", value)
    return result


def _value_parts(value: object) -> tuple[str | None, dict[str, str]]:
    if isinstance(value, dict):
        if "value" not in value:
            return None, {}
        raw_attributes = value.get("attributes", {})
        if not isinstance(raw_attributes, dict):
            return None, {}
        attributes = {str(key): str(item) for key, item in raw_attributes.items()}
        raw_value = value.get("value")
        return (None if raw_value is None else str(raw_value), attributes)
    if isinstance(value, str | int | float | bool):
        return str(value), {}
    return None, {}


def _extract_value(field: ElementTree.Element) -> object | None:
    field_type = field.attrib.get("type", "input")
    if field_type == "multiComplex":
        instances = _children_named(field, "complex-values")
        if not instances:
            return None
        return [_extract_complex_value(instance) for instance in instances]
    if field_type == "complex":
        instances = _children_named(field, "complex-value")
        if not instances:
            return None
        return _extract_complex_value(instances[0])
    if field_type in _MULTI_TYPES:
        containers = _children_named(field, "values")
        if not containers:
            return None
        return [
            _extract_scalar_value(value)
            for value in _children_named(containers[0], "value")
        ]
    values = _children_named(field, "value")
    if not values:
        return None
    return _extract_scalar_value(values[0])


def _extract_complex_value(container: ElementTree.Element) -> dict[str, object]:
    result: dict[str, object] = {}
    for field in _children_named(container, "field"):
        field_id = field.attrib.get("id")
        value = _extract_value(field)
        if field_id and value is not None:
            result[field_id] = value
    return result


def _extract_scalar_value(value: ElementTree.Element) -> object:
    text = value.text or ""
    if not value.attrib:
        return text
    return {"value": text, "attributes": dict(value.attrib)}


def _is_empty(value: object) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _integer(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


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


def _children_named(
    element: ElementTree.Element,
    name: str,
) -> list[ElementTree.Element]:
    return [child for child in list(element) if _local_name(child.tag) == name]


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _issue(field: str, rule: str, message: str) -> SchemaValidationIssue:
    return SchemaValidationIssue(field=field, rule=rule, message=message)
