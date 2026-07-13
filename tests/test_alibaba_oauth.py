from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from backend.app.config import Settings
from backend.app.database import Database
from backend.app.services import alibaba_oauth as oauth_module
from backend.app.services.alibaba_oauth import (
    AlibabaOAuthError,
    AlibabaOAuthStore,
    create_workspace_authorization_url,
)


def _oauth_settings() -> Settings:
    return Settings(
        _env_file=None,
        alibaba_app_key="app-key",
        alibaba_app_secret="app-secret",
        alibaba_oauth_redirect_uri="https://merchant.example.com/api/v1/alibaba/oauth/callback",
        alibaba_api_base_url="https://gateway.example.com/rest",
    )


def _mock_token_client(
    monkeypatch: pytest.MonkeyPatch, payloads: list[dict[str, object]]
) -> list[httpx.Request]:
    captured: list[httpx.Request] = []
    queue = list(payloads)

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=queue.pop(0))

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        oauth_module.httpx,
        "AsyncClient",
        lambda **_: real_async_client(transport=transport),
    )
    return captured


@pytest.mark.asyncio
async def test_exchange_code_uses_gop_gateway_and_stores_multiple_merchants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _oauth_settings()
    store = AlibabaOAuthStore()
    captured = _mock_token_client(
        monkeypatch,
        [
            {
                "access_token": "AT-A",
                "refresh_token": "RT-A",
                "expires_in": 3600,
                "user_info": {"user_id": "111", "loginId": "merchant-a"},
                "account": "a@example.com",
                "code": "0",
            },
            {
                "access_token": "AT-B",
                "refresh_token": "RT-B",
                "expires_in": 3600,
                "user_info": {"user_id": "222", "loginId": "merchant-b"},
                "code": "0",
            },
        ],
    )

    state_a = store._create_state(settings)
    token_a = await store.exchange_code("code-a", state_a, settings)
    state_b = store._create_state(settings)
    token_b = await store.exchange_code("code-b", state_b, settings)

    assert token_a.access_token == "AT-A"
    assert token_b.user_id == "222"
    assert str(captured[0].url) == "https://gateway.example.com/rest"
    body = captured[0].content.decode()
    assert "method=%2Fauth%2Ftoken%2Fcreate" in body
    assert "code=code-a" in body
    assert "partner_id=iop-sdk-python-20250910" in body

    status = store.status(settings)
    assert status["user_id"] == "222"
    assert {entry["login_id"] for entry in status["stores"]} == {"merchant-a", "merchant-b"}
    assert sum(1 for entry in status["stores"] if entry["active"]) == 1


@pytest.mark.asyncio
async def test_exchange_code_raises_on_provider_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _oauth_settings()
    store = AlibabaOAuthStore()
    _mock_token_client(
        monkeypatch,
        [{"code": "InvalidCode", "type": "ISP", "message": "Invalid authorization code"}],
    )

    state = store._create_state(settings)
    with pytest.raises(AlibabaOAuthError, match="Invalid authorization code"):
        await store.exchange_code("bad-code", state, settings)


def test_new_platform_authorization_url_uses_canonical_seller_flow() -> None:
    settings = Settings(
        _env_file=None,
        alibaba_app_key="app-key",
        alibaba_app_secret="app-secret",
        alibaba_oauth_redirect_uri="https://merchant.example.com/api/v1/alibaba/oauth/callback",
    )
    url = AlibabaOAuthStore().create_authorization_url(settings)
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    assert (
        f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        == "https://openapi-auth.alibaba.com/oauth/authorize"
    )
    assert query["client_id"] == ["app-key"]
    assert query["redirect_uri"] == [
        "https://merchant.example.com/api/v1/alibaba/oauth/callback"
    ]
    assert query["response_type"] == ["code"]
    assert query["state"][0]
    assert query["sp"] == ["icbu"]
    assert "force_auth" not in query
    assert "view" not in query
    assert "force_login" not in query


def test_legacy_authorization_url_keeps_icbu_server_parameters() -> None:
    settings = Settings(
        _env_file=None,
        alibaba_app_key="app-key",
        alibaba_app_secret="app-secret",
        alibaba_oauth_authorize_url="https://oauth.alibaba.com/authorize",
        alibaba_oauth_redirect_uri="https://merchant.example.com/api/v1/alibaba/oauth/callback",
    )

    query = parse_qs(urlparse(AlibabaOAuthStore().create_authorization_url(settings)).query)

    assert query["sp"] == ["icbu"]
    assert query["view"] == ["web"]


def test_workspace_authorization_url_uses_one_time_state_without_force_login(
    tmp_path: Path,
) -> None:
    settings = Settings(
        _env_file=None,
        database_path=str(tmp_path / "oauth.db"),
        registration_codes="INVITE",
        token_encryption_key="test-only-token-encryption-key",
        alibaba_app_key="app-key",
        alibaba_app_secret="app-secret",
        alibaba_oauth_redirect_uri="https://merchant.example.com/api/v1/alibaba/oauth/callback",
    )
    database = Database(settings)
    user, _ = database.register(
        email="owner@example.com",
        password="strong-password",
        display_name="Owner",
        workspace_name="Example Trading",
        registration_code="INVITE",
    )

    url = create_workspace_authorization_url(settings, database, user)
    query = parse_qs(urlparse(url).query)

    assert "force_login" not in query
    assert "force_auth" not in query
    assert query["sp"] == ["icbu"]
    assert "view" not in query
    assert database.consume_oauth_state(query["state"][0]) == (user.workspace_id, user.id)


def test_authorization_requires_server_side_app_configuration() -> None:
    settings = Settings(_env_file=None)

    with pytest.raises(AlibabaOAuthError):
        AlibabaOAuthStore().create_authorization_url(settings)


def test_static_access_token_is_reported_as_environment_connection() -> None:
    settings = Settings(
        _env_file=None,
        alibaba_app_key="app-key",
        alibaba_app_secret="app-secret",
        alibaba_access_token="access-token",
    )

    assert AlibabaOAuthStore().status(settings)["connection_source"] == "environment"


def test_access_token_without_app_credentials_is_not_reported_as_connected() -> None:
    settings = Settings(
        _env_file=None,
        alibaba_access_token="access-token",
    )

    assert AlibabaOAuthStore().status(settings)["connection_state"] == "unconfigured"


def test_new_platform_environment_aliases_are_supported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALIBABA_GATEWAY", "https://gateway.example.com/rest")
    monkeypatch.setenv("ALIBABA_AUTHORIZE_URL", "https://auth.example.com/oauth/authorize")

    settings = Settings(_env_file=None)

    assert settings.alibaba_api_base_url == "https://gateway.example.com/rest"
    assert settings.alibaba_oauth_authorize_url == "https://auth.example.com/oauth/authorize"


def test_oauth_configuration_rejects_alibaba_homepage_callback() -> None:
    settings = Settings(
        _env_file=None,
        alibaba_app_key="app-key",
        alibaba_app_secret="app-secret",
        alibaba_oauth_redirect_uri="https://www.alibaba.com",
    )

    status = AlibabaOAuthStore().status(settings)

    assert status["connection_state"] == "configuration_error"
    assert "不能指向 Alibaba 首页" in status["configuration_error"]


def test_signed_state_survives_store_recreation_and_rejects_tampering() -> None:
    now = datetime(2026, 7, 11, tzinfo=UTC)
    settings = Settings(
        _env_file=None,
        alibaba_app_key="app-key",
        alibaba_app_secret="app-secret",
        alibaba_oauth_redirect_uri="https://merchant.example.com/api/v1/alibaba/oauth/callback",
    )
    authorization_url = AlibabaOAuthStore(clock=lambda: now).create_authorization_url(settings)
    state = parse_qs(urlparse(authorization_url).query)["state"][0]
    recreated_store = AlibabaOAuthStore(clock=lambda: now + timedelta(minutes=1))

    recreated_store._validate_state(state, settings)
    with pytest.raises(AlibabaOAuthError):
        recreated_store._validate_state(f"{state}tampered", settings)


def test_signed_state_expires_after_ten_minutes() -> None:
    now = datetime(2026, 7, 11, tzinfo=UTC)
    settings = Settings(
        _env_file=None,
        alibaba_app_key="app-key",
        alibaba_app_secret="app-secret",
        alibaba_oauth_redirect_uri="https://merchant.example.com/api/v1/alibaba/oauth/callback",
    )
    authorization_url = AlibabaOAuthStore(clock=lambda: now).create_authorization_url(settings)
    state = parse_qs(urlparse(authorization_url).query)["state"][0]

    with pytest.raises(AlibabaOAuthError):
        AlibabaOAuthStore(clock=lambda: now + timedelta(minutes=11))._validate_state(
            state,
            settings,
        )
