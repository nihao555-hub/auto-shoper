import hashlib
import json
import secrets
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
    def __init__(self) -> None:
        self._states: set[str] = set()
        self._token: AlibabaOAuthToken | None = None

    @property
    def token(self) -> AlibabaOAuthToken | None:
        return self._token

    def create_authorization_url(self, settings: Settings) -> str:
        if not settings.has_alibaba_oauth_app:
            raise AlibabaOAuthError(
                "Alibaba OAuth app is not configured; set app key, app secret, and redirect URI"
            )
        state = secrets.token_urlsafe(32)
        self._states.add(state)
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
        if state not in self._states:
            raise AlibabaOAuthError("Alibaba OAuth state is invalid or expired")
        self._states.remove(state)
        if not settings.has_alibaba_oauth_app:
            raise AlibabaOAuthError("Alibaba OAuth app is not configured")

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
                datetime.now(UTC) + timedelta(seconds=int(expires_in))
                if expires_in
                else None
            ),
        )

    def status(self, settings: Settings) -> dict[str, Any]:
        token = self._token
        connected = bool(settings.alibaba_access_token or token)
        return {
            "oauth_configured": settings.has_alibaba_oauth_app,
            "connected": connected,
            "connection_source": (
                "oauth" if token else "environment" if settings.alibaba_access_token else None
            ),
            "user_id": token.user_id if token else None,
            "expires_at": token.expires_at.isoformat() if token and token.expires_at else None,
        }


alibaba_oauth_store = AlibabaOAuthStore()


def get_alibaba_access_token() -> str | None:
    return alibaba_oauth_store.token.access_token if alibaba_oauth_store.token else None


def get_alibaba_oauth_store() -> AlibabaOAuthStore:
    return alibaba_oauth_store


def get_alibaba_oauth_status() -> dict[str, Any]:
    return alibaba_oauth_store.status(get_settings())
