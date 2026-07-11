from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from backend.app.config import Settings, get_settings
from backend.app.database import AuthenticatedUser, Database, get_database
from backend.app.models import AuthUserResponse, LoginRequest, RegisterRequest
from backend.app.services.auth import get_current_user

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])


def _response_user(user: AuthenticatedUser) -> AuthUserResponse:
    return AuthUserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        workspace_id=user.workspace_id,
        workspace_name=user.workspace_name,
    )


def _set_session_cookie(
    response: Response,
    request: Request,
    settings: Settings,
    token: str,
) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_days * 24 * 60 * 60,
        httponly=True,
        secure=(
            request.url.scheme == "https"
            or request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip() == "https"
        ),
        samesite="lax",
        path="/",
    )


@router.post("/register", response_model=AuthUserResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    database: Annotated[Database, Depends(get_database)],
) -> AuthUserResponse:
    if not database.settings.configured_registration_codes:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="注册暂未开放，请向管理员获取注册码",
        )
    try:
        user, session_token = database.register(
            email=payload.email,
            password=payload.password,
            display_name=payload.display_name,
            workspace_name=payload.workspace_name,
            registration_code=payload.registration_code,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    _set_session_cookie(response, request, database.settings, session_token)
    return _response_user(user)


@router.post("/login", response_model=AuthUserResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    database: Annotated[Database, Depends(get_database)],
) -> AuthUserResponse:
    result = database.login(payload.email, payload.password)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
        )
    user, session_token = result
    _set_session_cookie(response, request, database.settings, session_token)
    return _response_user(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    database: Annotated[Database, Depends(get_database)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        database.delete_session(token)
    response.delete_cookie(settings.session_cookie_name, path="/")


@router.get("/me", response_model=AuthUserResponse)
def me(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> AuthUserResponse:
    return _response_user(user)
