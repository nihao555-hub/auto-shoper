from collections.abc import AsyncIterator

from fastapi import HTTPException

from backend.app.clients.ai import AIClient, AIProviderError
from backend.app.clients.alibaba import AlibabaClient, AlibabaConfigurationError
from backend.app.config import get_settings


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
    try:
        client = AlibabaClient(get_settings())
    except AlibabaConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        yield client
    finally:
        await client.close()
