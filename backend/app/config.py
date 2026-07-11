from functools import lru_cache
from urllib.parse import urlparse

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    app_name: str = "auto-shoper"
    model_provider: str = "openai"
    openai_api_key: str | None = None
    openai_base_url: str = "https://grsai.dakka.com.cn/v1"
    text_model: str = "gemini-3.1-flash-lite"
    image_provider: str = "grsai"
    image_model: str = "gpt-image-2"

    alibaba_app_key: str | None = None
    alibaba_app_secret: str | None = None
    alibaba_access_token: str | None = None
    alibaba_api_base_url: str = Field(
        default="https://openapi-api.alibaba.com/rest",
        validation_alias=AliasChoices("ALIBABA_API_BASE_URL", "ALIBABA_GATEWAY"),
    )
    alibaba_append_operation_to_url: bool = False
    alibaba_timeout_seconds: float = 30
    alibaba_oauth_authorize_url: str = Field(
        default="https://openapi-auth.alibaba.com/oauth/authorize",
        validation_alias=AliasChoices(
            "ALIBABA_OAUTH_AUTHORIZE_URL",
            "ALIBABA_AUTHORIZE_URL",
        ),
    )
    alibaba_oauth_token_url: str = "https://eco.taobao.com/router/rest"
    alibaba_oauth_redirect_uri: str | None = None
    alibaba_oauth_success_url: str = "http://localhost:5173/#/overview?alibaba=connected"

    max_upload_bytes: int = 10 * 1024 * 1024

    @property
    def has_alibaba_credentials(self) -> bool:
        return bool(
            self.alibaba_app_key
            and self.alibaba_app_secret
            and self.alibaba_access_token
        )

    @property
    def has_alibaba_oauth_app(self) -> bool:
        return self.alibaba_oauth_configuration_error is None

    @property
    def alibaba_oauth_configuration_error(self) -> str | None:
        if not self.alibaba_app_key or not self.alibaba_app_secret:
            return "Alibaba OAuth AppKey/AppSecret 未配置"
        if not self.alibaba_oauth_redirect_uri:
            return "Alibaba OAuth 回调地址未配置"
        redirect = urlparse(self.alibaba_oauth_redirect_uri)
        if redirect.scheme not in {"http", "https"} or not redirect.netloc:
            return "Alibaba OAuth 回调地址必须是完整 URL"
        hostname = (redirect.hostname or "").lower()
        if hostname == "alibaba.com" or hostname.endswith(".alibaba.com"):
            return "Alibaba OAuth 回调地址必须指向本服务，不能指向 Alibaba 首页"
        if redirect.scheme != "https" and hostname not in {"localhost", "127.0.0.1"}:
            return "Alibaba OAuth 公网回调地址必须使用 HTTPS"
        if not redirect.path.rstrip("/").endswith("/api/v1/alibaba/oauth/callback"):
            return "Alibaba OAuth 回调地址必须以 /api/v1/alibaba/oauth/callback 结尾"
        return None


@lru_cache
def get_settings() -> Settings:
    return Settings()
