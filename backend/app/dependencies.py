from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException

from backend.app.clients.ai import AIClient, AIProviderError
from backend.app.clients.alibaba import AlibabaClient, AlibabaConfigurationError
from backend.app.config import get_settings
from backend.app.database import AuthenticatedUser, Database, get_database
from backend.app.services.auth import get_current_user


async def get_ai_client() -> AsyncIterator[AIClient]:
    try:
        client = AIClient(get_settings())
    except AIProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        yield client
    finally:
        await client.close()


async def get_alibaba_client(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> AsyncIterator[AlibabaClient]:
    settings = get_settings()
    store = database.get_active_store(user.workspace_id)
    if store is None:
        raise HTTPException(status_code=409, detail="请先连接并选择 Alibaba 店铺")
    if store.expired:
        raise HTTPException(status_code=409, detail="当前 Alibaba 店铺授权已过期")
    settings = settings.model_copy(update={"alibaba_access_token": store.access_token})
    try:
        client = AlibabaClient(settings)
    except AlibabaConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        yield client
    finally:
        await client.close()
