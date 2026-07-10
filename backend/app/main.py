from fastapi import FastAPI

from backend.app.config import get_settings
from backend.app.routes import router

app = FastAPI(
    title=get_settings().app_name,
    version="0.1.0",
    description="Alibaba.com listing automation and AI image backend",
)
app.include_router(router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
