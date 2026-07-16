from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette import status

from backend.app.auth_routes import router as auth_router
from backend.app.config import get_settings
from backend.app.routes import router
from backend.app.services.auth import get_current_user
from backend.app.store_routes import router as store_router

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
settings = get_settings()
STAGED_VIDEO_DIRECTORY = Path(settings.staged_video_directory).resolve()
STAGED_VIDEO_DIRECTORY.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Alibaba.com listing automation, AI image, and merchant workspace",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_origin_regex=settings.cors_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)
app.include_router(auth_router)
app.include_router(store_router)
app.include_router(router, dependencies=[Depends(get_current_user)])
app.mount(
    "/public/videos",
    StaticFiles(directory=STAGED_VIDEO_DIRECTORY),
    name="staged-videos",
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


FRONTEND_INDEX = FRONTEND_DIST / "index.html"
FRONTEND_ASSETS = FRONTEND_DIST / "assets"

if FRONTEND_INDEX.is_file() and FRONTEND_ASSETS.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_ASSETS),
        name="frontend-assets",
    )

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        requested_file = (FRONTEND_DIST / path).resolve()
        if FRONTEND_DIST.resolve() in requested_file.parents and requested_file.is_file():
            return FileResponse(requested_file)
        return FileResponse(FRONTEND_INDEX)
