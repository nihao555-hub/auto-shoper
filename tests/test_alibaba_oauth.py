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

    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "https://oauth.alibaba.com/authorize"
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
