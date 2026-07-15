from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient

from backend.app.dependencies import get_ai_client, get_alibaba_client
from backend.app.main import app
from backend.app.services.categories import (
    CategoryRecord,
    category_children,
    extract_category_records,
    recommend_category_paths,
)

pytestmark = pytest.mark.usefixtures("authenticated_app")


def test_extract_category_records_normalizes_alibaba_shapes() -> None:
    records = extract_category_records(
        {
            "result": {
                "category": {
                    "category_id": 12,
                    "name": "Arts & Crafts",
                    "leaf_category": False,
                    "level": 1,
                    "child_ids": {"number": [34, 56]},
                }
            }
        }
    )

    assert records == [
        {
            "id": "12",
            "name": "Arts & Crafts",
            "leaf": False,
            "level": 1,
            "child_ids": ["34", "56"],
        }
    ]


def test_extract_category_records_keeps_nameless_structural_root() -> None:
    records = extract_category_records(
        {
            "result": {
                "success": True,
                "result": {
                    "category_id": 0,
                    "name": "",
                    "leaf_category": False,
                    "level": 0,
                    "child_ids": [12, 34],
                },
            }
        }
    )

    assert records == [
        {
            "id": "0",
            "name": "",
            "leaf": False,
            "level": 0,
            "child_ids": ["12", "34"],
        }
    ]


def test_category_children_reports_embedded_and_missing_children() -> None:
    records = [
        {
            "id": "12",
            "name": "Arts & Crafts",
            "leaf": False,
            "level": 1,
            "child_ids": ["34", "56"],
        },
        {
            "id": "34",
            "name": "Art Paper",
            "leaf": True,
            "level": 2,
            "child_ids": [],
        },
    ]

    parent, children, missing = category_children("12", records)

    assert parent == records[0]
    assert children == [records[1]]
    assert missing == ["56"]


def test_root_category_payload_can_return_top_level_records_directly() -> None:
    records = [
        {
            "id": "12",
            "name": "Arts & Crafts",
            "leaf": False,
            "level": 1,
            "child_ids": [],
        }
    ]

    parent, children, missing = category_children("0", records)

    assert parent is None
    assert children == records
    assert missing == []


def test_root_category_payload_recovers_embedded_children_without_child_ids() -> None:
    records = extract_category_records(
        {
            "result": {
                "category": {
                    "category_id": 0,
                    "category_name": "Root",
                    "is_leaf_category": False,
                    "level": 0,
                    "children": [
                        {
                            "category_id": 12,
                            "category_name": "Arts & Crafts",
                            "is_leaf_category": False,
                            "level": 1,
                        },
                        {
                            "category_id": 34,
                            "category_name": "Office & School Supplies",
                            "is_leaf_category": False,
                            "level": 1,
                        },
                    ],
                }
            }
        }
    )

    parent, children, missing = category_children("0", records)

    assert parent is not None
    assert parent["id"] == "0"
    assert [child["id"] for child in children] == ["12", "34"]
    assert missing == []


def test_category_parser_supports_alibaba_child_category_id_alias() -> None:
    records = extract_category_records(
        {
            "categoryId": "12",
            "categoryName": "Arts & Crafts",
            "isLeafCategory": False,
            "childCategoryIds": [34, 56],
        }
    )

    assert records[0]["leaf"] is False
    assert records[0]["child_ids"] == ["34", "56"]


class _CategoryClient:
    async def call(
        self,
        operation: str,
        parameters: dict[str, object] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
    ) -> dict[str, object]:
        category_id = str((parameters or {})["cat_id"])
        if category_id == "0":
            return {
                "result": {
                    "category": {
                        "category_id": 0,
                        "name": "",
                        "leaf_category": False,
                        "child_ids": [12],
                    }
                }
            }
        return {
            "result": {
                "category": {
                    "category_id": 12,
                    "name": "Arts & Crafts",
                    "leaf_category": True,
                    "child_ids": [],
                }
            }
        }


async def _category_client() -> AsyncIterator[_CategoryClient]:
    yield _CategoryClient()


def test_category_children_endpoint_loads_live_child_details() -> None:
    app.dependency_overrides[get_alibaba_client] = _category_client
    try:
        response = TestClient(app).get("/api/v1/alibaba/categories/0/children")
    finally:
        app.dependency_overrides.pop(get_alibaba_client, None)

    assert response.status_code == 200
    assert response.json()["categories"] == [
        {
            "id": "12",
            "name": "Arts & Crafts",
            "leaf": True,
            "level": None,
            "child_ids": [],
        }
    ]


class _CategoryAIClient:
    async def rank_category_candidates(
        self,
        *,
        title: str,
        keywords: list[str],
        category_hint: str,
        visible_traits: list[str],
        candidates: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        assert title == "Watercolor Paper Pad"
        assert candidates[0]["category_id"] == "12"
        return [{"category_id": "12", "confidence": 0.91, "reason": "属于美术用品。"}]


async def _category_ai_client() -> AsyncIterator[_CategoryAIClient]:
    yield _CategoryAIClient()


def test_category_recommendation_endpoint_returns_real_leaf_path() -> None:
    app.dependency_overrides[get_alibaba_client] = _category_client
    app.dependency_overrides[get_ai_client] = _category_ai_client
    try:
        response = TestClient(app).post(
            "/api/v1/alibaba/categories/recommend",
            json={
                "title": "Watercolor Paper Pad",
                "keywords": ["watercolor paper"],
                "category_hint": "Arts & Crafts",
                "visible_traits": ["paper pad"],
            },
        )
    finally:
        app.dependency_overrides.pop(get_alibaba_client, None)
        app.dependency_overrides.pop(get_ai_client, None)

    assert response.status_code == 200
    result = response.json()
    assert result["strategy"] == "ai"
    assert result["recommendations"][0]["category_id"] == "12"
    assert result["recommendations"][0]["path"][0]["name"] == "Arts & Crafts"


class _EmbeddedRootCategoryClient:
    async def call(
        self,
        operation: str,
        parameters: dict[str, object] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
    ) -> dict[str, object]:
        assert str((parameters or {})["cat_id"]) == "0"
        return {
            "result": {
                "category": {
                    "category_id": 0,
                    "category_name": "Root",
                    "is_leaf_category": False,
                    "level": 0,
                    "children": [
                        {
                            "category_id": 12,
                            "category_name": "Arts & Crafts",
                            "is_leaf_category": False,
                            "level": 1,
                        }
                    ],
                }
            }
        }


async def _embedded_root_category_client() -> AsyncIterator[_EmbeddedRootCategoryClient]:
    yield _EmbeddedRootCategoryClient()


def test_category_children_endpoint_returns_embedded_root_categories() -> None:
    app.dependency_overrides[get_alibaba_client] = _embedded_root_category_client
    try:
        response = TestClient(app).get("/api/v1/alibaba/categories/0/children")
    finally:
        app.dependency_overrides.pop(get_alibaba_client, None)

    assert response.status_code == 200
    assert response.json()["categories"] == [
        {
            "id": "12",
            "name": "Arts & Crafts",
            "leaf": False,
            "level": 1,
            "child_ids": [],
        }
    ]


@pytest.mark.asyncio
async def test_category_recommendation_only_descends_through_ranked_real_ids() -> None:
    tree: dict[str, list[CategoryRecord]] = {
        "0": [
            {
                "id": "12",
                "name": "Arts & Crafts",
                "leaf": False,
                "level": 1,
                "child_ids": ["34"],
            },
            {
                "id": "90",
                "name": "Office Supplies",
                "leaf": True,
                "level": 1,
                "child_ids": [],
            },
        ],
        "12": [
            {
                "id": "34",
                "name": "Watercolor Paper",
                "leaf": True,
                "level": 2,
                "child_ids": [],
            }
        ],
    }
    ranked_ids = iter(["12", "34"])

    async def load_children(category_id: str) -> list[CategoryRecord]:
        return tree.get(category_id, [])

    async def rank_candidates(candidates: list[dict[str, object]]) -> list[dict[str, object]]:
        selected_id = next(ranked_ids)
        assert selected_id in {str(candidate["category_id"]) for candidate in candidates}
        return [
            {
                "category_id": selected_id,
                "confidence": 0.93,
                "reason": "商品是水彩纸。",
            }
        ]

    recommendations, strategy = await recommend_category_paths(
        load_children=load_children,
        rank_candidates=rank_candidates,
        search_text="300gsm watercolor paper",
    )

    assert strategy == "ai"
    assert recommendations[0]["category_id"] == "34"
    assert [item["id"] for item in recommendations[0]["path"]] == ["12", "34"]


@pytest.mark.asyncio
async def test_category_recommendation_rejects_unknown_ai_ids_and_falls_back() -> None:
    leaf: CategoryRecord = {
        "id": "34",
        "name": "Watercolor Paper",
        "leaf": True,
        "level": 1,
        "child_ids": [],
    }

    async def load_children(category_id: str) -> list[CategoryRecord]:
        return [leaf] if category_id == "0" else []

    async def rank_candidates(candidates: list[dict[str, object]]) -> list[dict[str, object]]:
        return [{"category_id": "invented-id", "confidence": 1, "reason": "invalid"}]

    recommendations, strategy = await recommend_category_paths(
        load_children=load_children,
        rank_candidates=rank_candidates,
        search_text="watercolor paper",
    )

    assert strategy == "keyword_fallback"
    assert recommendations[0]["category_id"] == "34"
