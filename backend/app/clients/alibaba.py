import hashlib
import hmac
import json
import time
from typing import Any

import httpx

from backend.app.config import Settings


class AlibabaConfigurationError(RuntimeError):
    pass


class AlibabaAPIError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class AlibabaClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        if not settings.has_alibaba_credentials:
            raise AlibabaConfigurationError("Alibaba API credentials are not configured")
        self.settings = settings
        self.client = httpx.AsyncClient(
            timeout=settings.alibaba_timeout_seconds,
            transport=transport,
        )

    async def close(self) -> None:
        await self.client.aclose()

    @staticmethod
    def generate_signature(params: dict[str, str], secret: str, operation: str) -> str:
        canonical = operation + "".join(f"{key}{value}" for key, value in sorted(params.items()))
        return hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest().upper()

    async def call(
        self,
        operation: str,
        parameters: dict[str, Any] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
    ) -> dict[str, Any]:
        params = self._base_parameters(operation)
        for key, value in (parameters or {}).items():
            params[key] = self._serialize(value)
        params["sign"] = self.generate_signature(
            params,
            self.settings.alibaba_app_secret or "",
            operation,
        )
        url = self.settings.alibaba_api_base_url.rstrip("/")
        if self.settings.alibaba_append_operation_to_url:
            url += operation
        headers = {"X-Protocol": "GOP"}
        if not files:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        response = await self.client.post(url, data=params, files=files, headers=headers)
        try:
            data = response.json()
        except ValueError as exc:
            raise AlibabaAPIError(
                f"Alibaba API returned non-JSON HTTP {response.status_code}"
            ) from exc
        if response.is_error:
            raise AlibabaAPIError(
                self._error_message(data, response.status_code),
                status_code=502,
            )
        if isinstance(data, dict) and data.get("success") is False:
            raise AlibabaAPIError(self._error_message(data, response.status_code))
        if not isinstance(data, dict):
            raise AlibabaAPIError("Alibaba API returned an invalid response")
        return data

    def _base_parameters(self, operation: str) -> dict[str, str]:
        return {
            "app_key": self.settings.alibaba_app_key or "",
            "format": "json",
            "method": operation,
            "access_token": self.settings.alibaba_access_token or "",
            "sign_method": "sha256",
            "timestamp": str(int(time.time() * 1000)),
        }

    @staticmethod
    def _serialize(value: Any) -> str:
        if isinstance(value, dict | list):
            return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        if isinstance(value, bool):
            return str(value).lower()
        return str(value)

    @staticmethod
    def _error_message(data: Any, status_code: int) -> str:
        if isinstance(data, dict):
            for key in ("errorMessage", "message", "error_description", "error"):
                if data.get(key):
                    return f"Alibaba API error: {data[key]}"
        return f"Alibaba API returned HTTP {status_code}"
