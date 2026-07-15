import hashlib
import hmac
import json
import time
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import httpx

from backend.app.config import Settings

IOP_SDK_PARTNER_ID = "iop-sdk-python-20250910"


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

    @staticmethod
    def generate_top_signature(params: dict[str, str], secret: str) -> str:
        canonical = "".join(f"{key}{value}" for key, value in sorted(params.items()))
        return hmac.new(secret.encode(), canonical.encode(), hashlib.md5).hexdigest().upper()

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
        headers = (
            {}
            if files
            else {"Content-Type": "application/x-www-form-urlencoded"}
        )
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
        if not isinstance(data, dict):
            raise AlibabaAPIError("Alibaba API returned an invalid response")
        code = data.get("code")
        if code not in (None, 0, "0") or data.get("success") is False:
            raise AlibabaAPIError(self._error_message(data, response.status_code))
        business_error = self._business_error(data)
        if business_error is not None:
            raise AlibabaAPIError(business_error)
        return data

    async def call_top(
        self,
        method: str,
        parameters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        china_standard_time = datetime.now(UTC).astimezone(timezone(timedelta(hours=8)))
        params = {
            "app_key": self.settings.alibaba_app_key or "",
            "format": "json",
            "method": method,
            "session": self.settings.alibaba_access_token or "",
            "sign_method": "hmac",
            "timestamp": china_standard_time.strftime("%Y-%m-%d %H:%M:%S"),
            "v": "2.0",
        }
        for key, value in (parameters or {}).items():
            params[key] = self._serialize(value)
        params["sign"] = self.generate_top_signature(
            params,
            self.settings.alibaba_app_secret or "",
        )
        response = await self.client.post(self.settings.alibaba_top_api_base_url, data=params)
        try:
            data = response.json()
        except ValueError as exc:
            raise AlibabaAPIError(
                f"Alibaba TOP API returned non-JSON HTTP {response.status_code}"
            ) from exc
        if not isinstance(data, dict):
            raise AlibabaAPIError("Alibaba TOP API returned an invalid response")
        error = data.get("error_response")
        if response.is_error or isinstance(error, dict):
            raise AlibabaAPIError(self._top_error_message(data, response.status_code))
        return data

    def _base_parameters(self, operation: str) -> dict[str, str]:
        return {
            "app_key": self.settings.alibaba_app_key or "",
            "format": "json",
            "method": operation,
            "access_token": self.settings.alibaba_access_token or "",
            "partner_id": IOP_SDK_PARTNER_ID,
            "sign_method": "sha256",
            "simplify": "true",
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
            details: list[str] = []
            for key in ("errorMessage", "message", "error_description", "error"):
                if data.get(key):
                    details.append(str(data[key]))
                    break
            code = data.get("code") or data.get("error_code")
            if code:
                details.append(f"code={code}")
            trace_id = data.get("trace_id") or data.get("_trace_id_")
            if trace_id:
                details.append(f"trace_id={trace_id}")
            if details:
                return f"Alibaba API error: {'; '.join(details)}"
        return f"Alibaba API returned HTTP {status_code}"

    @staticmethod
    def _top_error_message(data: dict[str, Any], status_code: int) -> str:
        error = data.get("error_response")
        if isinstance(error, dict):
            message = error.get("sub_msg") or error.get("msg") or "TOP request failed"
            code = error.get("sub_code") or error.get("code")
            request_id = error.get("request_id")
            details = [str(message)]
            if code:
                details.append(f"code={code}")
            if request_id:
                details.append(f"request_id={request_id}")
            return f"Alibaba TOP API error: {'; '.join(details)}"
        return f"Alibaba TOP API returned HTTP {status_code}"

    @classmethod
    def _business_error(cls, data: dict[str, Any]) -> str | None:
        result = data.get("result")
        if not isinstance(result, dict):
            return None
        success_keys = ("success", "biz_success", "bizSuccess")
        if not any(result.get(key) is False for key in success_keys):
            return None
        details: list[str] = []
        for key in ("message", "message_info", "error_message", "msg"):
            if result.get(key):
                details.append(str(result[key]))
                break
        code = result.get("msg_code") or result.get("error_code")
        if code:
            details.append(f"code={code}")
        trace_id = result.get("trace_id") or data.get("_trace_id_")
        if trace_id:
            details.append(f"trace_id={trace_id}")
        message = "; ".join(details) or "business operation failed"
        return f"Alibaba API error: {message}"
