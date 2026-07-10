import hashlib
import hmac

import httpx
import pytest

from backend.app.clients.alibaba import AlibabaClient
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
        assert "schema_data=%7B%22title%22%3A%22Desk%22%7D" in body
        assert "secret" not in body
        assert request.headers["X-Protocol"] == "GOP"
        return httpx.Response(200, json={"success": True, "result": {"draftId": "1"}})

    client = AlibabaClient(alibaba_settings(), httpx.MockTransport(handler))
    try:
        result = await client.call(
            "/icbu/product/schema/add/draft",
            {"schema_data": {"title": "Desk"}},
        )
    finally:
        await client.close()
    assert result["result"]["draftId"] == "1"
