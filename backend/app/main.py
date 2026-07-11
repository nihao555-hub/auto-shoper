from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette import status

from backend.app.config import get_settings
from backend.app.routes import router

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

app = FastAPI(
    title=get_settings().app_name,
    version="0.1.0",
    description="Alibaba.com listing automation, AI image, and merchant workspace",
)
app.include_router(router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


if FRONTEND_DIST.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="frontend-assets",
    )

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        requested_file = (FRONTEND_DIST / path).resolve()
        if FRONTEND_DIST.resolve() in requested_file.parents and requested_file.is_file():
            return FileResponse(requested_file)
        return FileResponse(FRONTEND_DIST / "index.html")
