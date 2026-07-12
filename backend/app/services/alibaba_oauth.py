import base64
import hashlib
import hmac
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx

from backend.app.clients.alibaba import AlibabaClient
from backend.app.config import Settings, get_settings
from backend.app.database import AuthenticatedUser, Database, StoreConnection

TOKEN_CREATE_OPERATION = "/auth/token/create"
TOKEN_REFRESH_OPERATION = "/auth/token/refresh"


class AlibabaOAuthError(RuntimeError):
    pass


@dataclass
class AlibabaOAuthToken:
    access_token: str
    refresh_token: str | None
    user_id: str | None
    expires_at: datetime | None
    login_id: str | None = None
    account: str | None = None
    refresh_expires_at: datetime | None = None


class AlibabaOAuthStore:
    def __init__(self, clock: Callable[[], datetime] | None = None) -> None:
        self._clock = clock or (lambda: datetime.now(UTC))
        self._tokens: dict[str, AlibabaOAuthToken] = {}
        self._active_key: str | None = None

    @property
    def token(self) -> AlibabaOAuthToken | None:
        if self._active_key is None:
            return None
        return self._tokens.get(self._active_key)

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
            }
        )
        return f"{settings.alibaba_oauth_authorize_url}?{query}"

    async def exchange_code(self, code: str, state: str, settings: Settings) -> AlibabaOAuthToken:
        if not settings.has_alibaba_oauth_app:
            raise AlibabaOAuthError(
                settings.alibaba_oauth_configuration_error or "Alibaba OAuth 配置无效"
            )
        self._validate_state(state, settings)
        payload = await self._request_token(
            settings, TOKEN_CREATE_OPERATION, {"code": code}
        )
        return self._store_token(payload)

    async def refresh(self, user_id: str, settings: Settings) -> AlibabaOAuthToken:
        token = self._tokens.get(user_id)
        if token is None or not token.refresh_token:
            raise AlibabaOAuthError("该商家没有可用的 refresh token")
        payload = await self._request_token(
            settings, TOKEN_REFRESH_OPERATION, {"refresh_token": token.refresh_token}
        )
        return self._store_token(payload)

    async def _request_token(
        self, settings: Settings, operation: str, extra: dict[str, str]
    ) -> dict[str, Any]:
        params: dict[str, str] = {
            "app_key": settings.alibaba_app_key or "",
            "format": "json",
            "method": operation,
            "sign_method": "sha256",
            "simplify": "true",
            "partner_id": "auto-shoper",
            "timestamp": str(int(time.time() * 1000)),
        }
        params.update({key: str(value) for key, value in extra.items()})
        params["sign"] = AlibabaClient.generate_signature(
            params, settings.alibaba_app_secret or "", operation
        )
        url = settings.alibaba_api_base_url.rstrip("/")
        async with httpx.AsyncClient(timeout=settings.alibaba_timeout_seconds) as client:
            response = await client.post(url, data=params)
        try:
            payload = response.json()
        except ValueError as exc:
            raise AlibabaOAuthError("Alibaba token endpoint returned non-JSON") from exc
        if not isinstance(payload, dict):
            raise AlibabaOAuthError("Alibaba token response was not an object")
        code = payload.get("code")
        if (code not in (None, "0", 0)) or not payload.get("access_token"):
            message = (
                payload.get("message")
                or payload.get("error_description")
                or "token exchange failed"
            )
            raise AlibabaOAuthError(f"Alibaba OAuth error: {message}")
        return payload

    def _store_token(self, payload: dict[str, Any]) -> AlibabaOAuthToken:
        user_info = payload.get("user_info")
        if not isinstance(user_info, dict):
            user_info = {}
        user_id = self._optional_str(user_info.get("user_id") or payload.get("user_id"))
        token = AlibabaOAuthToken(
            access_token=str(payload["access_token"]),
            refresh_token=self._optional_str(payload.get("refresh_token")),
            user_id=user_id,
            expires_at=self._expiry(payload.get("expires_in")),
            login_id=self._optional_str(user_info.get("loginId")),
            account=self._optional_str(payload.get("account")),
            refresh_expires_at=self._expiry(payload.get("refresh_expires_in")),
        )
        key = user_id or "default"
        self._tokens[key] = token
        self._active_key = key
        return token

    def _expiry(self, seconds: Any) -> datetime | None:
        if not seconds:
            return None
        return self._clock() + timedelta(seconds=int(seconds))

    @staticmethod
    def _optional_str(value: Any) -> str | None:
        return str(value) if value else None

    def connected_stores(self) -> list[dict[str, Any]]:
        stores: list[dict[str, Any]] = []
        for key, token in self._tokens.items():
            expired = bool(token.expires_at and token.expires_at <= self._clock())
            stores.append(
                {
                    "user_id": token.user_id,
                    "login_id": token.login_id,
                    "account": token.account,
                    "expires_at": token.expires_at.isoformat() if token.expires_at else None,
                    "expired": expired,
                    "active": key == self._active_key,
                }
            )
        return stores

    def status(self, settings: Settings) -> dict[str, Any]:
        token = self.token
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
            "stores": self.connected_stores(),
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


def create_workspace_authorization_url(
    settings: Settings,
    database: Database,
    user: AuthenticatedUser,
) -> str:
    if not settings.has_alibaba_oauth_app:
        raise AlibabaOAuthError(
            settings.alibaba_oauth_configuration_error or "Alibaba OAuth 配置无效"
        )
    if not settings.encryption_key_material:
        raise AlibabaOAuthError("Alibaba token 加密密钥未配置")
    state = database.create_oauth_state(user)
    query = urlencode(
        {
            "response_type": "code",
            "client_id": settings.alibaba_app_key,
            "redirect_uri": settings.alibaba_oauth_redirect_uri,
            "state": state,
            "view": "web",
            "sp": "ICBU",
        }
    )
    return f"{settings.alibaba_oauth_authorize_url}?{query}"


async def exchange_workspace_code(
    code: str,
    state: str,
    settings: Settings,
    database: Database,
) -> StoreConnection:
    identity = database.consume_oauth_state(state)
    if identity is None:
        raise AlibabaOAuthError("Alibaba OAuth state 无效、已使用或已过期")
    workspace_id, _ = identity
    store = AlibabaOAuthStore()
    payload = await store._request_token(settings, TOKEN_CREATE_OPERATION, {"code": code})
    token = store._store_token(payload)
    try:
        return database.upsert_store(
            workspace_id=workspace_id,
            provider_user_id=token.user_id,
            login_id=token.login_id,
            account=token.account,
            access_token=token.access_token,
            refresh_token=token.refresh_token,
            expires_at=token.expires_at,
            refresh_expires_at=token.refresh_expires_at,
        )
    except RuntimeError as exc:
        raise AlibabaOAuthError(str(exc)) from exc


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
