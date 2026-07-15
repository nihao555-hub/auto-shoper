import asyncio
import re
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, Literal, TypedDict


class CategoryRecord(TypedDict):
    id: str
    name: str
    leaf: bool
    level: int | None
    child_ids: list[str]


class CategoryRecommendation(TypedDict):
    category_id: str
    path: list[CategoryRecord]
    confidence: float
    reason: str


CategoryLoader = Callable[[str], Awaitable[list[CategoryRecord]]]
CategoryRanker = Callable[[list[dict[str, Any]]], Awaitable[list[dict[str, Any]]]]

_ID_KEYS = ("category_id", "categoryId", "cat_id", "catId", "id")
_NAME_KEYS = ("name", "category_name", "categoryName", "display_name", "displayName")
_LEAF_KEYS = (
    "leaf_category",
    "leafCategory",
    "is_leaf_category",
    "isLeafCategory",
    "is_leaf",
    "isLeaf",
    "leaf",
)
_CHILD_KEYS = (
    "child_ids",
    "childIds",
    "child_category_ids",
    "childCategoryIds",
    "children_ids",
    "childrenIds",
)


def extract_category_records(payload: object) -> list[CategoryRecord]:
    records: dict[str, CategoryRecord] = {}

    def visit(value: object) -> None:
        if isinstance(value, Mapping):
            category_id = _first(value, _ID_KEYS)
            name = _first(value, _NAME_KEYS)
            normalized_name = name.strip() if isinstance(name, str) else ""
            child_ids = _as_string_list(_first(value, _CHILD_KEYS))
            if category_id not in (None, "") and (normalized_name or child_ids):
                normalized_id = str(category_id)
                records[normalized_id] = {
                    "id": normalized_id,
                    "name": normalized_name,
                    "leaf": _as_bool(_first(value, _LEAF_KEYS)),
                    "level": _as_int(value.get("level")),
                    "child_ids": child_ids,
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
    if not child_ids and not parent["leaf"]:
        other_records = [record for record in records if record["id"] != category_id]
        if parent["level"] is not None:
            direct_level = parent["level"] + 1
            level_children = [
                record for record in other_records if record["level"] == direct_level
            ]
            if level_children:
                return parent, level_children, []
        known_levels = [record["level"] for record in other_records if record["level"] is not None]
        if known_levels:
            nearest_level = min(known_levels)
            return (
                parent,
                [record for record in other_records if record["level"] == nearest_level],
                [],
            )
        # Some category responses embed only the immediate children and omit both
        # child_ids and level. In that shape, every other normalized record is a child.
        return parent, other_records, []
    embedded_children = [record for record in records if record["id"] in child_ids]
    missing_child_ids = [
        child_id
        for child_id in child_ids
        if all(record["id"] != child_id for record in embedded_children)
    ]
    return parent, embedded_children, missing_child_ids


async def recommend_category_paths(
    *,
    load_children: CategoryLoader,
    rank_candidates: CategoryRanker,
    search_text: str,
    limit: int = 3,
    max_depth: int = 6,
) -> tuple[list[CategoryRecommendation], Literal["ai", "keyword_fallback"]]:
    active_paths: list[list[CategoryRecord]] = [[]]
    completed: dict[str, CategoryRecommendation] = {}
    strategy: Literal["ai", "keyword_fallback"] = "ai"

    for _ in range(max_depth):
        candidates: list[list[CategoryRecord]] = []
        loaded_levels = await asyncio.gather(
            *(load_children(path[-1]["id"] if path else "0") for path in active_paths)
        )
        for path, children in zip(active_paths, loaded_levels, strict=True):
            if not children and path:
                current = path[-1]
                terminal: CategoryRecord = {
                    "id": current["id"],
                    "name": current["name"],
                    "leaf": True,
                    "level": current["level"],
                    "child_ids": current["child_ids"],
                }
                terminal_path = [*path[:-1], terminal]
                completed[terminal["id"]] = {
                    "category_id": terminal["id"],
                    "path": terminal_path,
                    "confidence": 0.55,
                    "reason": "Alibaba 未返回更下级类目，提交前仍会使用实时 Schema 校验。",
                }
                continue
            candidates.extend([*path, child] for child in children)

        if not candidates:
            break

        candidate_payloads = [
            {
                "category_id": path[-1]["id"],
                "path": " > ".join(item["name"] for item in path if item["name"]),
                "leaf": path[-1]["leaf"],
            }
            for path in _prefilter_candidates(candidates, search_text, max_candidates=120)
        ]
        candidate_lookup = {path[-1]["id"]: path for path in candidates}
        ranked = await rank_candidates(candidate_payloads)
        valid_ranked = [
            item
            for item in ranked
            if str(item.get("category_id", "")) in candidate_lookup
        ]
        if not valid_ranked:
            strategy = "keyword_fallback"
            valid_ranked = _keyword_rankings(candidates, search_text, limit)

        next_active: list[list[CategoryRecord]] = []
        for ranked_item in valid_ranked[:limit]:
            category_id = str(ranked_item["category_id"])
            path = candidate_lookup[category_id]
            recommendation: CategoryRecommendation = {
                "category_id": category_id,
                "path": path,
                "confidence": _confidence(ranked_item.get("confidence")),
                "reason": str(ranked_item.get("reason") or "根据商品信息匹配。"),
            }
            if path[-1]["leaf"]:
                completed[category_id] = recommendation
            else:
                next_active.append(path)
        active_paths = next_active
        if not active_paths:
            break

    recommendations = sorted(
        completed.values(),
        key=lambda item: item["confidence"],
        reverse=True,
    )
    return recommendations[:limit], strategy


def _prefilter_candidates(
    candidates: list[list[CategoryRecord]],
    search_text: str,
    *,
    max_candidates: int,
) -> list[list[CategoryRecord]]:
    if len(candidates) <= max_candidates:
        return candidates
    return sorted(
        candidates,
        key=lambda path: _text_score(path, search_text),
        reverse=True,
    )[:max_candidates]


def _keyword_rankings(
    candidates: list[list[CategoryRecord]], search_text: str, limit: int
) -> list[dict[str, Any]]:
    scored = [(path, _text_score(path, search_text)) for path in candidates]
    ranked = sorted(
        ((path, score) for path, score in scored if score > 0),
        key=lambda item: item[1],
        reverse=True,
    )[:limit]
    return [
        {
            "category_id": path[-1]["id"],
            "confidence": min(0.72, 0.45 + (score * 0.04)),
            "reason": "AI 类目排序暂不可用，已按商品标题、关键词和类目名称匹配。",
        }
        for path, score in ranked
    ]


def _text_score(path: list[CategoryRecord], search_text: str) -> float:
    query = _tokens(search_text)
    category_text = " ".join(item["name"] for item in path)
    category_tokens = _tokens(category_text)
    if not query or not category_tokens:
        return 0
    overlap = len(query & category_tokens)
    phrase_bonus = sum(
        1 for item in path if item["name"] and item["name"].casefold() in search_text.casefold()
    )
    return overlap + (phrase_bonus * 2)


def _tokens(value: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]+", value.casefold()) if token}


def _confidence(value: object) -> float:
    if isinstance(value, int | float) and not isinstance(value, bool):
        return max(0.0, min(1.0, float(value)))
    return 0.5


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
