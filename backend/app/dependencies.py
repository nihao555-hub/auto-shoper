from collections.abc import AsyncIterator

from fastapi import HTTPException

from backend.app.clients.ai import AIClient, AIProviderError
from backend.app.clients.alibaba import AlibabaClient, AlibabaConfigurationError
from backend.app.config import get_settings
from backend.app.services.alibaba_oauth import get_alibaba_access_token


async def get_ai_client() -> AsyncIterator[AIClient]:
    try:
        client = AIClient(get_settings())
    except AIProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        yield client
    finally:
        await client.close()


async def get_alibaba_client() -> AsyncIterator[AlibabaClient]:
    settings = get_settings()
    oauth_access_token = get_alibaba_access_token()
    if oauth_access_token:
        settings = settings.model_copy(update={"alibaba_access_token": oauth_access_token})
    try:
        client = AlibabaClient(settings)
    except AlibabaConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        yield client
    finally:
        await client.close()
