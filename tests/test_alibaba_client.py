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


def test_top_signature_uses_hmac_md5_and_sorted_parameters() -> None:
    params = {"b": "2", "a": "1"}
    expected = hmac.new(b"secret", b"a1b2", hashlib.md5).hexdigest().upper()
    assert AlibabaClient.generate_top_signature(params, "secret") == expected


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
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_top_call_uses_session_and_reports_nested_errors() -> None:
    responses = iter(
        [
            {
                "alibaba_wholesale_shippingline_template_list_response": {
                    "list_template_response": {
                        "total": 1,
                        "items": [{"id": 123, "title": "快捷模板"}],
                    }
                }
            },
            {
                "error_response": {
                    "code": 27,
                    "msg": "Invalid session",
                    "sub_code": "invalid-sessionkey",
                    "request_id": "request-1",
                }
            },
        ]
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        body = (await request.aread()).decode()
        assert request.url == "https://eco.taobao.com/router/rest"
        assert "method=alibaba.wholesale.shippingline.template.list" in body
        assert "session=token" in body
        assert "sign_method=hmac" in body
        assert "v=2.0" in body
        assert "secret" not in body
        return httpx.Response(200, json=next(responses))

    client = AlibabaClient(alibaba_settings(), httpx.MockTransport(handler))
    try:
        result = await client.call_top(
            "alibaba.wholesale.shippingline.template.list",
            {"page_num": 1, "count": 10},
        )
        assert result["alibaba_wholesale_shippingline_template_list_response"][
            "list_template_response"
        ]["total"] == 1
        with pytest.raises(
            AlibabaAPIError,
            match="Invalid session; code=invalid-sessionkey; request_id=request-1",
        ):
            await client.call_top("alibaba.wholesale.shippingline.template.list")
    finally:
        await client.close()
