import hashlib
import hmac
import json
from collections.abc import Iterator
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from backend.app.clients.alibaba import AlibabaAPIError, AlibabaConfigurationError
from backend.app.config import Settings


class AlibabaTopClient:
    """Client for legacy TOP APIs that are not exposed by the ICBU GOP gateway."""

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        if not settings.has_alibaba_credentials:
            raise AlibabaConfigurationError("Alibaba TOP credentials are not configured")
        self.settings = settings
        self.client = httpx.AsyncClient(
            timeout=settings.alibaba_timeout_seconds,
            transport=transport,
        )

    async def close(self) -> None:
        await self.client.aclose()

    @staticmethod
    def generate_signature(params: dict[str, str], secret: str) -> str:
        canonical = "".join(f"{key}{value}" for key, value in sorted(params.items()))
        return hmac.new(secret.encode(), canonical.encode(), hashlib.md5).hexdigest().upper()

    async def call(
        self,
        method: str,
        parameters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        params = self._base_parameters(method)
        params.update(
            {
                key: self._serialize(value)
                for key, value in (parameters or {}).items()
                if value is not None
            }
        )
        params["sign"] = self.generate_signature(
            params,
            self.settings.alibaba_app_secret or "",
        )
        response = await self.client.post(
            self.settings.alibaba_top_api_base_url,
            data=params,
            headers={"Content-Type": "application/x-www-form-urlencoded;charset=utf-8"},
        )
        try:
            data = response.json()
        except ValueError as exc:
            raise AlibabaAPIError(
                f"Alibaba TOP returned non-JSON HTTP {response.status_code}"
            ) from exc
        if response.is_error:
            raise AlibabaAPIError(self._error_message(data, response.status_code))
        if not isinstance(data, dict):
            raise AlibabaAPIError("Alibaba TOP returned an invalid response")
        error_response = data.get("error_response")
        if isinstance(error_response, dict):
            raise AlibabaAPIError(self._error_message(error_response, response.status_code))
        for result in self._nested_dicts(data):
            if result.get("model") is False:
                raise AlibabaAPIError(self._error_message(result, response.status_code))
            if any(
                result.get(key) is False
                for key in ("success", "biz_success", "bizSuccess", "sub_success")
            ):
                raise AlibabaAPIError(self._error_message(result, response.status_code))
            msg_code = str(result.get("msg_code") or "").strip()
            if msg_code and msg_code not in {"0", "200", "00000"}:
                raise AlibabaAPIError(self._error_message(result, response.status_code))
        return data

    def _base_parameters(self, method: str) -> dict[str, str]:
        return {
            "app_key": self.settings.alibaba_app_key or "",
            "format": "json",
            "method": method,
            "session": self.settings.alibaba_access_token or "",
            "sign_method": "hmac",
            "simplify": "true",
            "timestamp": datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M:%S"),
            "v": "2.0",
        }

    @staticmethod
    def _serialize(value: Any) -> str:
        if isinstance(value, dict | list):
            return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        if isinstance(value, bool):
            return str(value).lower()
        return str(value)

    @classmethod
    def _nested_dicts(cls, value: dict[str, Any]) -> Iterator[dict[str, Any]]:
        yield value
        for nested in value.values():
            if isinstance(nested, dict):
                yield from cls._nested_dicts(nested)

    @staticmethod
    def _error_message(data: Any, status_code: int) -> str:
        if isinstance(data, dict):
            message = next(
                (
                    str(data[key])
                    for key in (
                        "sub_error_msg",
                        "sub_msg",
                        "msg_info",
                        "msg",
                        "message",
                    )
                    if data.get(key)
                ),
                f"HTTP {status_code}",
            )
            code = next(
                (
                    str(data[key])
                    for key in ("sub_error_code", "sub_code", "msg_code", "code")
                    if data.get(key) is not None
                ),
                "",
            )
            return f"Alibaba TOP API error: {message}{f'; code={code}' if code else ''}"
        return f"Alibaba TOP returned HTTP {status_code}"
