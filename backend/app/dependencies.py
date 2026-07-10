from collections.abc import AsyncIterator

from backend.app.clients.ai import AIClient
from backend.app.clients.alibaba import AlibabaClient
from backend.app.config import get_settings


async def get_ai_client() -> AsyncIterator[AIClient]:
    client = AIClient(get_settings())
    try:
        yield client
    finally:
        await client.close()


async def get_alibaba_client() -> AsyncIterator[AlibabaClient]:
    client = AlibabaClient(get_settings())
    try:
        yield client
    finally:
        await client.close()
