from collections.abc import Mapping
from contextlib import suppress
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
    MerchantAssets,
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
            "total_item",
            "totalItem",
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


def _merchant_assets_payload(assets: MerchantAssets | None) -> dict[str, str]:
    if assets is None:
        return {
            "company_profile": "",
            "after_sales_policy": "",
            "customization_policy": "",
            "detail_template": "",
            "origin": "",
            "brand": "",
        }
    return {
        "company_profile": assets.company_profile,
        "after_sales_policy": assets.after_sales_policy,
        "customization_policy": assets.customization_policy,
        "detail_template": assets.detail_template,
        "origin": assets.origin,
        "brand": assets.brand,
    }


def _store_payload(
    store: StoreConnection,
    assets: MerchantAssets | None = None,
    template_defaults: dict[str, str] | None = None,
) -> dict[str, object]:
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
        "merchant_assets": _merchant_assets_payload(assets),
        "template_defaults": template_defaults or {},
    }


def _first_text(payload: object, keys: set[str]) -> str:
    if isinstance(payload, Mapping):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for value in payload.values():
            result = _first_text(value, keys)
            if result:
                return result
    elif isinstance(payload, list):
        for value in payload:
            result = _first_text(value, keys)
            if result:
                return result
    return ""


def _first_scalar(payload: object, keys: set[str]) -> str:
    if isinstance(payload, Mapping):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, int | float):
                return str(value)
        for value in payload.values():
            result = _first_scalar(value, keys)
            if result:
                return result
    elif isinstance(payload, list):
        for value in payload:
            result = _first_scalar(value, keys)
            if result:
                return result
    return ""


def _first_product_id(payload: object) -> str:
    official_id = _first_scalar(payload, {"product_id", "productId"})
    if official_id:
        return official_id
    if isinstance(payload, Mapping):
        products = payload.get("products")
        if products is not None:
            fallback_id = _first_scalar(products, {"id"})
            if fallback_id:
                return fallback_id
        for value in payload.values():
            result = _first_product_id(value)
            if result:
                return result
    elif isinstance(payload, list):
        for value in payload:
            result = _first_product_id(value)
            if result:
                return result
    return ""


def _first_named_record(
    payload: object,
    *,
    id_keys: set[str],
    name_keys: set[str],
) -> tuple[str, str]:
    if isinstance(payload, Mapping):
        record_id = _first_scalar(payload, id_keys)
        record_name = _first_text(payload, name_keys)
        if record_id and record_name:
            return record_id, record_name
        for value in payload.values():
            result = _first_named_record(value, id_keys=id_keys, name_keys=name_keys)
            if all(result):
                return result
    elif isinstance(payload, list):
        for value in payload:
            result = _first_named_record(value, id_keys=id_keys, name_keys=name_keys)
            if all(result):
                return result
    return "", ""


async def _fetch_product_payloads(
    client: AlibabaClient,
    product_payload: object,
) -> list[object]:
    payloads: list[object] = [product_payload]
    product_id = _first_product_id(product_payload)
    if product_id:
        with suppress(AlibabaAPIError):
            payloads.append(
                await client.call(
                    OPERATIONS["product_get"].operation,
                    {"product_get_request": {"productId": product_id}},
                )
            )
    return payloads


def _merchant_assets_from_payloads(payloads: list[object]) -> dict[str, str]:
    return {
        "company_profile": _first_text(
            payloads,
            {
                "company_profile",
                "companyProfile",
                "company_introduction",
                "companyIntroduction",
                "company_description",
                "companyDescription",
                "company_name",
                "companyName",
                "seller_company_name",
                "sellerCompanyName",
            },
        ),
        "after_sales_policy": _first_text(
            payloads,
            {
                "after_sales_policy",
                "afterSalesPolicy",
                "after_sales",
                "afterSales",
                "service_policy",
                "servicePolicy",
            },
        ),
        "customization_policy": _first_text(
            payloads,
            {
                "customization_policy",
                "customizationPolicy",
                "customization",
                "customized_service",
                "customizedService",
            },
        ),
        "detail_template": _first_text(
            payloads,
            {
                "detail_page_template",
                "detailPageTemplate",
                "detail_template",
                "detailTemplate",
            },
        ),
        "origin": _first_text(
            payloads,
            {
                "country_of_origin",
                "countryOfOrigin",
                "origin_country",
                "originCountry",
                "country",
            },
        ),
        "brand": _first_text(payloads, {"brand", "brand_name", "brandName"}),
    }


def _template_defaults(
    product_payloads: list[object],
    photobank_payload: object | None,
    merchant_assets: dict[str, str],
) -> dict[str, str]:
    product_group_id, product_group_label = _first_named_record(
        product_payloads,
        id_keys={"group_id", "groupId", "product_group_id", "productGroupId"},
        name_keys={"group_name", "groupName", "product_group_name", "productGroupName"},
    )
    photo_group_id, photo_group_label = _first_named_record(
        photobank_payload,
        id_keys={"id", "group_id", "groupId"},
        name_keys={"name", "group_name", "groupName"},
    )
    values = {
        "currency": _first_scalar(
            product_payloads,
            {"currency", "currency_code", "currencyCode"},
        ),
        "priceUnit": _first_scalar(
            product_payloads,
            {"price_unit", "priceUnit", "unit", "unit_name", "unitName"},
        ),
        "productGroupId": product_group_id,
        "productGroupLabel": product_group_label,
        "photoBankGroupId": photo_group_id,
        "photoBankGroupLabel": photo_group_label,
        "warehouseId": _first_scalar(
            product_payloads,
            {"warehouse_id", "warehouseId"},
        ),
        "warehouseLabel": _first_text(
            product_payloads,
            {"warehouse_name", "warehouseName"},
        ),
        "shippingTemplateId": _first_scalar(
            product_payloads,
            {
                "shipping_template_id",
                "shippingTemplateId",
                "freight_template_id",
                "freightTemplateId",
            },
        ),
        "shippingTemplateLabel": _first_text(
            product_payloads,
            {
                "shipping_template_name",
                "shippingTemplateName",
                "freight_template_name",
                "freightTemplateName",
            },
        ),
        "inventoryCode": _first_scalar(
            product_payloads,
            {"inventory_code", "inventoryCode", "warehouse_code", "warehouseCode"},
        ),
        "companyProfile": merchant_assets["company_profile"],
        "brand": merchant_assets["brand"],
        "origin": merchant_assets["origin"],
    }
    return {key: value for key, value in values.items() if value}


async def _sync_store(
    database: Database,
    settings: Settings,
    store: StoreConnection,
) -> tuple[StoreConnection, dict[str, str]]:
    client_settings = settings.model_copy(update={"alibaba_access_token": store.access_token})
    client = AlibabaClient(client_settings)
    permissions = dict(store.permissions)
    errors: list[str] = []
    product_count = store.product_count
    photobank_group_count = store.photobank_group_count
    merchant_assets = {
        "company_profile": "",
        "after_sales_policy": "",
        "customization_policy": "",
        "detail_template": "",
        "origin": "",
        "brand": "",
    }
    product_payloads: list[object] = []
    photobank_payload: object | None = None
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
        product_payloads = await _fetch_product_payloads(client, product_payload)
        merchant_assets = _merchant_assets_from_payloads(product_payloads)
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
    database.upsert_merchant_assets(
        workspace_id=store.workspace_id,
        store_connection_id=store.id,
        **merchant_assets,
    )
    synced_store = database.update_store_summary(
        workspace_id=store.workspace_id,
        store_id=store.id,
        product_count=product_count,
        product_sync_state=product_state,
        photobank_group_count=photobank_group_count,
        photobank_sync_state=photobank_state,
        permissions=permissions,
        sync_error="；".join(errors) if errors else None,
    )
    return synced_store, _template_defaults(
        product_payloads,
        photobank_payload,
        merchant_assets,
    )


@router.get("/stores")
def list_stores(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> dict[str, object]:
    stores = database.list_stores(user.workspace_id)
    return {
        "active_store_id": next((store.id for store in stores if store.active), None),
        "stores": [
            _store_payload(store, database.get_merchant_assets(user.workspace_id, store.id))
            for store in stores
        ],
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
    return _store_payload(
        store,
        database.get_merchant_assets(user.workspace_id, store.id),
    )


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
        synced, template_defaults = await _sync_store(database, settings, store)
    except AlibabaAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return _store_payload(
        synced,
        database.get_merchant_assets(user.workspace_id, synced.id),
        template_defaults,
    )


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
        "stores": [
            _store_payload(store, database.get_merchant_assets(user.workspace_id, store.id))
            for store in stores
        ],
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
