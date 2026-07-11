from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from backend.app.config import Settings, get_settings
from backend.app.database import AuthenticatedUser, Database, get_database


def get_current_user(
    request: Request,
    database: Annotated[Database, Depends(get_database)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthenticatedUser:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    user = database.get_user_by_session(token)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期")
    return user
