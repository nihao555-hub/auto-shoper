from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse

from backend.app.alibaba_catalog import OPERATIONS
from backend.app.clients.alibaba import AlibabaAPIError, AlibabaClient
from backend.app.config import Settings, get_settings
from backend.app.database import (
    AuthenticatedUser,
    Database,
    StoreConnection,
    get_database,
)
from backend.app.services.alibaba_oauth import (
    AlibabaOAuthError,
    create_workspace_authorization_url,
    exchange_workspace_code,
)
from backend.app.services.auth import get_current_user

router = APIRouter(prefix="/api/v1/alibaba", tags=["alibaba-store-connections"])


def _extract_count(payload: object) -> int | None:
    if isinstance(payload, dict):
        for key in (
            "total",
            "total_count",
            "totalCount",
            "total_size",
            "totalSize",
            "count",
        ):
            value = payload.get(key)
            if isinstance(value, int):
                return value
            if isinstance(value, str) and value.isdigit():
                return int(value)
        for value in payload.values():
            count = _extract_count(value)
            if count is not None:
                return count
    if isinstance(payload, list):
        return len(payload)
    return None


def _store_payload(store: StoreConnection) -> dict[str, object]:
    permission_values = list(store.permissions.values())
    verified = sum(value == "verified" for value in permission_values)
    failed = sum(value == "failed" for value in permission_values)
    if store.expired:
        health = "expired"
    elif failed:
        health = "attention"
    elif verified:
        health = "healthy"
    else:
        health = "pending"
    if store.expired:
        draft_readiness = "blocked"
        blockers = ["店铺授权已过期"]
    elif store.permissions.get("draft_write") == "verified":
        draft_readiness = "ready"
        blockers = []
    else:
        draft_readiness = "verification_required"
        blockers = ["草稿写入权限将在首次安全草稿测试后确认"]
    return {
        "id": store.id,
        "user_id": store.provider_user_id,
        "login_id": store.login_id,
        "account": store.account,
        "expires_at": store.expires_at.isoformat() if store.expires_at else None,
        "expired": store.expired,
        "active": store.active,
        "created_at": store.created_at.isoformat(),
        "updated_at": store.updated_at.isoformat(),
        "last_sync_at": store.last_sync_at.isoformat() if store.last_sync_at else None,
        "product_count": store.product_count,
        "product_sync_state": store.product_sync_state,
        "photobank_group_count": store.photobank_group_count,
        "photobank_sync_state": store.photobank_sync_state,
        "product_group_count": store.product_group_count,
        "product_group_sync_state": store.product_group_sync_state,
        "permissions": store.permissions,
        "permission_health": health,
        "permission_verified_count": verified,
        "permission_total_count": len(permission_values),
        "draft_readiness": draft_readiness,
        "ready_to_create_draft": draft_readiness == "ready",
        "readiness_blockers": blockers,
        "sync_error": store.sync_error,
    }


async def _sync_store(
    database: Database,
    settings: Settings,
    store: StoreConnection,
) -> StoreConnection:
    client_settings = settings.model_copy(update={"alibaba_access_token": store.access_token})
    client = AlibabaClient(client_settings)
    permissions = dict(store.permissions)
    errors: list[str] = []
    product_count = store.product_count
    photobank_group_count = store.photobank_group_count
    product_state = "failed"
    photobank_state = "failed"
    try:
        product_payload = await client.call(
            OPERATIONS["product_list"].operation,
            {"current_page": 1, "page_size": 1, "language": "ENGLISH"},
        )
        product_count = _extract_count(product_payload)
        product_state = "synced"
        permissions["product_read"] = "verified"
    except AlibabaAPIError as exc:
        permissions["product_read"] = "failed"
        errors.append(f"商品同步：{exc}")
    try:
        photobank_payload = await client.call(
            OPERATIONS["photo_group_list"].operation,
            {"request": {"currentPage": 1, "pageSize": 1}},
        )
        photobank_group_count = _extract_count(photobank_payload)
        photobank_state = "synced"
        permissions["photobank_read"] = "verified"
    except AlibabaAPIError as exc:
        permissions["photobank_read"] = "failed"
        errors.append(f"图片银行：{exc}")
    finally:
        await client.close()
    return database.update_store_summary(
        workspace_id=store.workspace_id,
        store_id=store.id,
        product_count=product_count,
        product_sync_state=product_state,
        photobank_group_count=photobank_group_count,
        photobank_sync_state=photobank_state,
        permissions=permissions,
        sync_error="；".join(errors) if errors else None,
    )


@router.get("/stores")
def list_stores(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> dict[str, object]:
    stores = database.list_stores(user.workspace_id)
    return {
        "active_store_id": next((store.id for store in stores if store.active), None),
        "stores": [_store_payload(store) for store in stores],
    }


@router.get("/batches")
def list_batches(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> dict[str, object]:
    return {"batches": database.list_batches(user.workspace_id)}


@router.post("/stores/{store_id}/activate")
def activate_store(
    store_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> dict[str, object]:
    store = database.activate_store(user.workspace_id, store_id)
    if store is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="店铺不存在")
    return _store_payload(store)


@router.post("/stores/{store_id}/sync")
async def sync_store(
    store_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    store = database.get_store(user.workspace_id, store_id)
    if store is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="店铺不存在")
    if store.expired:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="店铺授权已过期")
    try:
        synced = await _sync_store(database, settings, store)
    except AlibabaAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return _store_payload(synced)


@router.get("/oauth/status")
def oauth_status(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    stores = database.list_stores(user.workspace_id)
    active = next((store for store in stores if store.active), None)
    if active and active.expired:
        connection_state = "expired"
    elif active:
        connection_state = "connected"
    elif settings.alibaba_oauth_configuration_error:
        connection_state = "unconfigured"
    else:
        connection_state = "not_connected"
    return {
        "oauth_configured": settings.has_alibaba_oauth_app,
        "connected": bool(active and not active.expired),
        "connection_state": connection_state,
        "connection_source": "oauth" if active else None,
        "user_id": active.provider_user_id if active else None,
        "expires_at": active.expires_at.isoformat() if active and active.expires_at else None,
        "configuration_error": settings.alibaba_oauth_configuration_error,
        "redirect_uri": settings.alibaba_oauth_redirect_uri,
        "active_store_id": active.id if active else None,
        "stores": [_store_payload(store) for store in stores],
    }


@router.post("/oauth/authorize")
def oauth_authorize(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    try:
        authorization_url = create_workspace_authorization_url(settings, database, user)
    except AlibabaOAuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return {"authorization_url": authorization_url}


def _callback_url(base: str, *, result: str, reason: str | None = None) -> str:
    if "alibaba=" in base:
        if not reason:
            return base
        separator = "&" if "?" in base else "?"
        return f"{base}{separator}{urlencode({'reason': reason})}"
    separator = "&" if "?" in base else "?"
    values = {"alibaba": result}
    if reason:
        values["reason"] = reason
    return f"{base}{separator}{urlencode(values)}"


@router.get("/oauth/callback")
async def oauth_callback(
    settings: Annotated[Settings, Depends(get_settings)],
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    if error:
        reason = (
            "denied"
            if error in {"access_denied", "authorization_declined"}
            else "provider_error"
        )
        return RedirectResponse(
            _callback_url(settings.alibaba_oauth_error_url, result="error", reason=reason)
        )
    if not code or not state:
        return RedirectResponse(
            _callback_url(
                settings.alibaba_oauth_error_url,
                result="error",
                reason="missing_callback_data",
            )
        )
    database = get_database()
    try:
        store = await exchange_workspace_code(code, state, settings, database)
        if not store.expired:
            await _sync_store(database, settings, store)
    except (AlibabaOAuthError, AlibabaAPIError):
        return RedirectResponse(
            _callback_url(
                settings.alibaba_oauth_error_url,
                result="error",
                reason="token_exchange_failed",
            )
        )
    return RedirectResponse(_callback_url(settings.alibaba_oauth_success_url, result="connected"))
