import hashlib
import hmac
import json
from urllib.parse import parse_qs

import httpx
import pytest

from backend.app.clients.alibaba import AlibabaAPIError
from backend.app.clients.alibaba_top import AlibabaTopClient
from backend.app.config import Settings


def top_settings() -> Settings:
    return Settings(
        _env_file=None,
        alibaba_app_key="top-key",
        alibaba_app_secret="top-secret",
        alibaba_access_token="top-session",
        alibaba_top_api_base_url="https://top.test/router/rest",
    )


@pytest.mark.asyncio
async def test_top_client_signs_and_queries_video_library() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://top.test/router/rest"
        values = {key: items[0] for key, items in parse_qs(request.content.decode()).items()}
        assert values["method"] == "alibaba.icbu.video.query"
        assert values["session"] == "top-session"
        assert values["current_page"] == "1"
        assert values["page_size"] == "20"
        signature_params = {key: value for key, value in values.items() if key != "sign"}
        canonical = "".join(
            f"{key}{value}" for key, value in sorted(signature_params.items())
        )
        expected = hmac.new(
            b"top-secret",
            canonical.encode(),
            hashlib.md5,
        ).hexdigest().upper()
        assert values["sign"] == expected
        return httpx.Response(
            200,
            json={
                "alibaba_icbu_video_query_response": {
                    "result": {
                        "model": {
                            "current_page": 1,
                            "page_size": 20,
                            "total_count": 1,
                            "list": [{"video_id": "encrypted-1", "title": "Product demo"}],
                        },
                        "msg_code": "200",
                        "msg_info": "success",
                    }
                }
            },
        )

    client = AlibabaTopClient(top_settings(), httpx.MockTransport(handler))
    try:
        response = await client.call(
            "alibaba.icbu.video.query",
            {"current_page": 1, "page_size": 20},
        )
    finally:
        await client.close()

    assert (
        response["alibaba_icbu_video_query_response"]["result"]["model"]["list"][0][
            "video_id"
        ]
        == "encrypted-1"
    )


@pytest.mark.asyncio
async def test_top_client_surfaces_permission_errors() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "error_response": {
                    "code": 27,
                    "sub_code": "isv.appkey-not-exists",
                    "sub_msg": "Invalid app Key",
                }
            },
        )

    client = AlibabaTopClient(top_settings(), httpx.MockTransport(handler))
    try:
        with pytest.raises(AlibabaAPIError, match="Invalid app Key"):
            await client.call(
                "alibaba.icbu.video.query",
                {"current_page": 1, "page_size": 20},
            )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_top_client_serializes_nested_inventory_request_as_json() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        values = {key: items[0] for key, items in parse_qs(request.content.decode()).items()}
        assert values["method"] == "alibaba.icbu.product.inventory.update"
        assert json.loads(values["request_param"]) == {
            "product_id": "123",
            "inventory_list": [
                {
                    "sku_id": "456",
                    "inventory_code": "CN_LOCAL_01",
                    "inventory": 10,
                    "operate": "plus",
                }
            ],
        }
        return httpx.Response(
            200,
            json={
                "alibaba_icbu_product_inventory_update_response": {
                    "result": {"success": True, "data": "true"}
                }
            },
        )

    client = AlibabaTopClient(top_settings(), httpx.MockTransport(handler))
    try:
        await client.call(
            "alibaba.icbu.product.inventory.update",
            {
                "request_param": {
                    "product_id": "123",
                    "inventory_list": [
                        {
                            "sku_id": "456",
                            "inventory_code": "CN_LOCAL_01",
                            "inventory": 10,
                            "operate": "plus",
                        }
                    ],
                }
            },
        )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_top_client_rejects_http_200_business_failure() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "alibaba_icbu_product_batch_update_display_response": {
                    "sub_success": False,
                    "sub_error_code": "SERVICE_INTERNAL_ERROR",
                    "sub_error_msg": "invalid display value",
                }
            },
        )

    client = AlibabaTopClient(top_settings(), httpx.MockTransport(handler))
    try:
        with pytest.raises(AlibabaAPIError, match="invalid display value"):
            await client.call(
                "alibaba.icbu.product.batch.update.display",
                {"new_display": "off", "product_id_list": "encrypted-id"},
            )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_top_client_rejects_video_msg_code_failure() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "alibaba_icbu_video_upload_response": {
                    "msg_code": "VIDEO_FORMAT_ERROR",
                    "msg_info": "unsupported video format",
                }
            },
        )

    client = AlibabaTopClient(top_settings(), httpx.MockTransport(handler))
    try:
        with pytest.raises(AlibabaAPIError, match="unsupported video format"):
            await client.call(
                "alibaba.icbu.video.upload",
                {"video_path": "https://cdn.test/video.mp4", "video_name": "video"},
            )
    finally:
        await client.close()
