from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest

from backend.app.config import Settings
from backend.app.services.alibaba_oauth import AlibabaOAuthError, AlibabaOAuthStore


def test_authorization_url_uses_icbu_server_flow() -> None:
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
    assert query["sp"] == ["ICBU"]
    assert query["state"][0]


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
