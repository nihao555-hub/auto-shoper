from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient

from backend.app.dependencies import get_alibaba_client
from backend.app.main import app
from backend.app.services.categories import category_children, extract_category_records

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
                        "name": "Root",
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
