import hashlib
import hmac

import httpx
import pytest

from backend.app.clients.alibaba import AlibabaAPIError, AlibabaClient
from backend.app.config import Settings


def alibaba_settings() -> Settings:
    return Settings(
        alibaba_app_key="app-key",
        alibaba_app_secret="secret",
        alibaba_access_token="token",
        alibaba_api_base_url="https://example.test/rest",
    )


def test_signature_uses_operation_and_sorted_parameters() -> None:
    params = {"b": "2", "a": "1"}
    expected = hmac.new(
        b"secret",
        b"/operationa1b2",
        hashlib.sha256,
    ).hexdigest().upper()
    assert AlibabaClient.generate_signature(params, "secret", "/operation") == expected


@pytest.mark.asyncio
async def test_call_serializes_json_and_does_not_send_secret() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        body = (await request.aread()).decode()
        assert (
            "param_product_top_publish_request=%7B%22language%22%3A%22en_US%22"
            "%2C%22cat_id%22%3A123%2C%22xml%22%3A%22%3CitemSchema%2F%3E%22%7D"
            in body
        )
        assert "secret" not in body
        assert "partner_id=iop-sdk-python-20250910" in body
        assert "simplify=true" in body
        assert "X-Protocol" not in request.headers
        return httpx.Response(200, json={"success": True, "result": {"draftId": "1"}})

    client = AlibabaClient(alibaba_settings(), httpx.MockTransport(handler))
    try:
        result = await client.call(
            "/icbu/product/schema/add/draft",
            {
                "param_product_top_publish_request": {
                    "language": "en_US",
                    "cat_id": 123,
                    "xml": "<itemSchema/>",
                }
            },
        )
    finally:
        await client.close()
    assert result["result"]["draftId"] == "1"


@pytest.mark.asyncio
async def test_call_rejects_gop_and_business_errors_with_trace_ids() -> None:
    responses = iter(
        [
            {
                "code": "MissingParameter",
                "message": "xml is required",
                "_trace_id_": "trace-1",
            },
            {
                "code": "0",
                "result": {
                    "success": False,
                    "message_info": "invalid inventory",
                    "msg_code": "600003",
                },
                "_trace_id_": "trace-2",
            },
            {
                "alibaba_icbu_product_schema_get_response": {
                    "biz_success": False,
                    "message": "category schema unavailable",
                    "msg_code": "SCHEMA_EMPTY",
                    "trace_id": "trace-3",
                }
            },
        ]
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=next(responses))

    client = AlibabaClient(alibaba_settings(), httpx.MockTransport(handler))
    try:
        with pytest.raises(AlibabaAPIError, match="trace_id=trace-1"):
            await client.call("/first")
        with pytest.raises(AlibabaAPIError, match="invalid inventory; code=600003"):
            await client.call("/second")
        with pytest.raises(
            AlibabaAPIError,
            match="category schema unavailable; code=SCHEMA_EMPTY; trace_id=trace-3",
        ):
            await client.call("/third")
    finally:
        await client.close()
