from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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
    alibaba_api_base_url: str = "https://openapi-api.alibaba.com/rest"
    alibaba_append_operation_to_url: bool = False
    alibaba_timeout_seconds: float = 30

    max_upload_bytes: int = 10 * 1024 * 1024

    @property
    def has_alibaba_credentials(self) -> bool:
        return bool(
            self.alibaba_app_key
            and self.alibaba_app_secret
            and self.alibaba_access_token
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
