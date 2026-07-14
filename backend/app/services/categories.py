from collections.abc import Mapping
from typing import TypedDict


class CategoryRecord(TypedDict):
    id: str
    name: str
    leaf: bool
    level: int | None
    child_ids: list[str]

_ID_KEYS = ("category_id", "categoryId", "cat_id", "catId", "id")
_NAME_KEYS = ("name", "category_name", "categoryName", "display_name", "displayName")
_LEAF_KEYS = ("leaf_category", "leafCategory", "is_leaf", "isLeaf")
_CHILD_KEYS = ("child_ids", "childIds", "children_ids", "childrenIds")


def extract_category_records(payload: object) -> list[CategoryRecord]:
    records: dict[str, CategoryRecord] = {}

    def visit(value: object) -> None:
        if isinstance(value, Mapping):
            category_id = _first(value, _ID_KEYS)
            name = _first(value, _NAME_KEYS)
            if category_id not in (None, "") and isinstance(name, str) and name.strip():
                normalized_id = str(category_id)
                records[normalized_id] = {
                    "id": normalized_id,
                    "name": name.strip(),
                    "leaf": _as_bool(_first(value, _LEAF_KEYS)),
                    "level": _as_int(value.get("level")),
                    "child_ids": _as_string_list(_first(value, _CHILD_KEYS)),
                }
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    visit(payload)
    return list(records.values())


def category_children(
    category_id: str,
    records: list[CategoryRecord],
) -> tuple[CategoryRecord | None, list[CategoryRecord], list[str]]:
    parent = next((record for record in records if record["id"] == category_id), None)
    if category_id == "0" and parent is None:
        return None, records, []
    if parent is None:
        return None, records, []

    child_ids = parent["child_ids"]
    embedded_children = [record for record in records if record["id"] in child_ids]
    missing_child_ids = [
        child_id
        for child_id in child_ids
        if all(record["id"] != child_id for record in embedded_children)
    ]
    return parent, embedded_children, missing_child_ids


def _first(value: Mapping[object, object], keys: tuple[str, ...]) -> object | None:
    for key in keys:
        if key in value:
            return value[key]
    return None


def _as_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes"}
    if isinstance(value, int | float):
        return value != 0
    return False


def _as_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return None


def _as_string_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item not in (None, "")]
    if isinstance(value, Mapping):
        for key in ("number", "long", "values", "value", "items"):
            if key in value:
                return _as_string_list(value[key])
    if value in (None, ""):
        return []
    return [str(value)]
