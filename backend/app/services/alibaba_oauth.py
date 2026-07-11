import base64
import hashlib
import hmac
import json
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from backend.app.config import Settings, get_settings


class AlibabaOAuthError(RuntimeError):
    pass


@dataclass
class AlibabaOAuthToken:
    access_token: str
    refresh_token: str | None
    user_id: str | None
    expires_at: datetime | None


class AlibabaOAuthStore:
    def __init__(self, clock: Callable[[], datetime] | None = None) -> None:
        self._clock = clock or (lambda: datetime.now(UTC))
        self._token: AlibabaOAuthToken | None = None

    @property
    def token(self) -> AlibabaOAuthToken | None:
        return self._token

    def create_authorization_url(self, settings: Settings) -> str:
        if not settings.has_alibaba_oauth_app:
            raise AlibabaOAuthError(
                settings.alibaba_oauth_configuration_error or "Alibaba OAuth 配置无效"
            )
        state = self._create_state(settings)
        query = urlencode(
            {
                "response_type": "code",
                "client_id": settings.alibaba_app_key,
                "redirect_uri": settings.alibaba_oauth_redirect_uri,
                "state": state,
                "view": "web",
                "sp": "ICBU",
                "force_login": "true",
            }
        )
        return f"{settings.alibaba_oauth_authorize_url}?{query}"

    async def exchange_code(self, code: str, state: str, settings: Settings) -> None:
        if not settings.has_alibaba_oauth_app:
            raise AlibabaOAuthError(
                settings.alibaba_oauth_configuration_error or "Alibaba OAuth 配置无效"
            )
        self._validate_state(state, settings)

        params = {
            "app_key": settings.alibaba_app_key or "",
            "code": code,
            "format": "json",
            "method": "taobao.top.auth.token.create",
            "sign_method": "md5",
            "timestamp": datetime.now(timezone(timedelta(hours=8))).strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
            "v": "2.0",
        }
        canonical = "".join(f"{key}{value}" for key, value in sorted(params.items()))
        secret = settings.alibaba_app_secret or ""
        params["sign"] = hashlib.md5(
            f"{secret}{canonical}{secret}".encode(),
            usedforsecurity=False,
        ).hexdigest().upper()

        async with httpx.AsyncClient(timeout=settings.alibaba_timeout_seconds) as client:
            response = await client.post(settings.alibaba_oauth_token_url, data=params)
        try:
            payload = response.json()
        except ValueError as exc:
            raise AlibabaOAuthError("Alibaba token endpoint returned non-JSON") from exc
        if response.is_error or "error_response" in payload:
            error = payload.get("error_response", payload)
            message = error.get("sub_msg") or error.get("msg") or "token exchange failed"
            raise AlibabaOAuthError(f"Alibaba OAuth error: {message}")

        token_result = payload.get("top_auth_token_create_response", {}).get("token_result")
        if isinstance(token_result, str):
            token_result = json.loads(token_result)
        if not isinstance(token_result, dict) or not token_result.get("access_token"):
            raise AlibabaOAuthError("Alibaba token response did not include an access token")

        expires_in = token_result.get("expires_in")
        self._token = AlibabaOAuthToken(
            access_token=str(token_result["access_token"]),
            refresh_token=(
                str(token_result["refresh_token"]) if token_result.get("refresh_token") else None
            ),
            user_id=str(token_result["user_id"]) if token_result.get("user_id") else None,
            expires_at=(
                self._clock() + timedelta(seconds=int(expires_in))
                if expires_in
                else None
            ),
        )

    def status(self, settings: Settings) -> dict[str, Any]:
        token = self._token
        token_expired = bool(token and token.expires_at and token.expires_at <= self._clock())
        environment_connected = settings.has_alibaba_credentials
        oauth_connected = bool(
            token
            and not token_expired
            and settings.alibaba_app_key
            and settings.alibaba_app_secret
        )
        connected = environment_connected or oauth_connected
        configuration_error = settings.alibaba_oauth_configuration_error
        if connected:
            connection_state = "connected"
        elif token_expired:
            connection_state = "expired"
        elif configuration_error:
            connection_state = (
                "unconfigured"
                if not settings.alibaba_app_key
                or not settings.alibaba_app_secret
                or not settings.alibaba_oauth_redirect_uri
                else "configuration_error"
            )
        else:
            connection_state = "not_connected"
        return {
            "oauth_configured": settings.has_alibaba_oauth_app,
            "connected": connected,
            "connection_state": connection_state,
            "connection_source": (
                "environment"
                if environment_connected
                else "oauth"
                if oauth_connected
                else None
            ),
            "user_id": token.user_id if token else None,
            "expires_at": token.expires_at.isoformat() if token and token.expires_at else None,
            "configuration_error": configuration_error,
            "redirect_uri": settings.alibaba_oauth_redirect_uri,
        }

    def _create_state(self, settings: Settings) -> str:
        issued_at = int(self._clock().timestamp())
        payload = f"{issued_at}:{secrets.token_urlsafe(24)}".encode()
        signature = hmac.new(
            (settings.alibaba_app_secret or "").encode(),
            payload,
            hashlib.sha256,
        ).digest()
        return f"{self._encode(payload)}.{self._encode(signature)}"

    def _validate_state(self, state: str, settings: Settings) -> None:
        try:
            payload_part, signature_part = state.split(".", maxsplit=1)
            payload = self._decode(payload_part)
            signature = self._decode(signature_part)
            issued_at_text, _ = payload.decode().split(":", maxsplit=1)
            issued_at = datetime.fromtimestamp(int(issued_at_text), UTC)
        except (ValueError, UnicodeDecodeError) as exc:
            raise AlibabaOAuthError("Alibaba OAuth state 无效或已过期") from exc
        expected = hmac.new(
            (settings.alibaba_app_secret or "").encode(),
            payload,
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(signature, expected):
            raise AlibabaOAuthError("Alibaba OAuth state 无效或已过期")
        age = self._clock() - issued_at
        if age < timedelta(0) or age > timedelta(minutes=10):
            raise AlibabaOAuthError("Alibaba OAuth state 无效或已过期")

    @staticmethod
    def _encode(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).rstrip(b"=").decode()

    @staticmethod
    def _decode(value: str) -> bytes:
        padding = "=" * (-len(value) % 4)
        return base64.urlsafe_b64decode(value + padding)


alibaba_oauth_store = AlibabaOAuthStore()


def get_alibaba_access_token() -> str | None:
    token = alibaba_oauth_store.token
    if not token or token.expires_at and token.expires_at <= datetime.now(UTC):
        return None
    return token.access_token


def get_alibaba_oauth_store() -> AlibabaOAuthStore:
    return alibaba_oauth_store


def get_alibaba_oauth_status() -> dict[str, Any]:
    return alibaba_oauth_store.status(get_settings())
