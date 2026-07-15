import asyncio
import hashlib
import json
import logging
import zipfile
from collections.abc import Mapping
from time import perf_counter
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from httpx import HTTPError

from backend.app.alibaba_catalog import OPERATIONS
from backend.app.clients.ai import AIClient, AIProviderError
from backend.app.clients.alibaba import (
    AlibabaAPIError,
    AlibabaClient,
    AlibabaConfigurationError,
)
from backend.app.config import get_settings
from backend.app.database import AuthenticatedUser, Database, get_database
from backend.app.dependencies import get_ai_client, get_alibaba_client
from backend.app.models import (
    AlibabaBatchPublishRequest,
    AlibabaBatchRequest,
    AlibabaBatchResult,
    AlibabaDisplayUpdateRequest,
    AlibabaDraftRenderRequest,
    AlibabaInventoryUpdateRequest,
    AlibabaPublishRequest,
    AlibabaSchemaRequest,
    AlibabaSchemaUpdateRequest,
    AsyncSchemaOptionsRequest,
    CategoryRecommendationRequest,
    CategoryRecommendationResult,
    DraftField,
    DraftFieldDifference,
    DraftSnapshotResult,
    FieldConfirmationRequest,
    FieldConfirmationResult,
    FieldSource,
    FieldTaskRequest,
    FieldTaskResult,
    ImageGenerationRequest,
    ImagePromptTemplate,
    ImageSlot,
    ListingFeatureFlags,
    ListingFeatureFlagsUpdate,
    ListingFieldGroup,
    ListingImportResult,
    ListingMetricEventRequest,
    ListingMetricsResult,
    ListingTemplateApplyRequest,
    ListingTemplateApplyResult,
    ListingTemplateCreateRequest,
    ListingTemplateResult,
    ListingTemplateUpdateRequest,
    OfficialListingBatchPublishRequest,
    OfficialListingBatchRequest,
    OfficialListingFlowResponse,
    OfficialListingPreparationResult,
    OfficialListingPrepareRequest,
    OfficialListingPublishRequest,
    OfficialListingValidationResult,
    ParsedSchemaField,
    ProductContentTranslationRequest,
    ProductContentTranslationResponse,
    ProductImageAnalysis,
    ProductImageCandidate,
    ProductImageGenerationRequest,
    ProductImageGenerationResponse,
    ProductImagePlanResponse,
    ProductValidationRequest,
    ProductValidationResult,
    SchemaBuildRequest,
    SchemaBuildResult,
    SchemaGuidanceResult,
    SchemaParseRequest,
    SchemaParseResult,
)
from backend.app.services.auth import get_current_user
from backend.app.services.categories import (
    CategoryRecord,
    category_children,
    extract_category_records,
    recommend_category_paths,
)
from backend.app.services.field_policy import (
    effective_listing_fields,
    get_listing_field,
    validate_product_fields,
)
from backend.app.services.field_tasks import (
    build_field_tasks,
    confirmable_ai_field,
    is_confirmable_category,
)
from backend.app.services.image_templates import (
    SLOT_TEMPLATES,
    build_slot_plan,
    build_slot_prompt,
    list_prompt_templates,
    resolve_slots,
)
from backend.app.services.listing_imports import parse_listing_import
from backend.app.services.official_listing import (
    build_official_checklist,
    listing_field_groups,
    official_listing_flow,
)
from backend.app.services.schema_guidance import (
    build_schema_guidance,
    render_guidance_prompt,
)
from backend.app.services.schema_rules import (
    SchemaParseError,
    manual_schema_fields,
    merge_schema_required_fields,
    parse_schema_data,
)
from backend.app.services.schema_values import build_schema_xml, validate_filled_schema_xml

router = APIRouter(prefix="/api/v1")
logger = logging.getLogger(__name__)


@router.get("/capabilities")
async def capabilities(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> dict[str, Any]:
    settings = get_settings()
    active_store = database.get_active_store(user.workspace_id)
    connected = bool(active_store and not active_store.expired)
    if active_store and active_store.expired:
        connection_state = "expired"
    elif active_store:
        connection_state = "connected"
    elif settings.alibaba_oauth_configuration_error:
        connection_state = "unconfigured"
    else:
        connection_state = "not_connected"
    return {
        "modules": {
            "alibaba_listing": True,
            "ai_images": True,
            "sales_expert": False,
        },
        "alibaba_credentials_configured": connected,
        "alibaba_oauth_configured": settings.has_alibaba_oauth_app,
        "alibaba_connection_state": connection_state,
        "alibaba_connection_source": "oauth" if active_store else None,
        "alibaba_oauth_configuration_error": settings.alibaba_oauth_configuration_error,
        "alibaba_oauth_redirect_uri": settings.alibaba_oauth_redirect_uri,
        "active_store_id": active_store.id if active_store else None,
        "model_credentials_configured": bool(settings.openai_api_key),
    }


def _bind_batch_to_active_store(
    batch_id: str,
    user: AuthenticatedUser,
    database: Database,
) -> None:
    store = database.get_active_store(user.workspace_id)
    if store is None or store.expired:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="当前工作区没有可用的 Alibaba 店铺",
        )
    if not database.ensure_batch(user.workspace_id, store.id, batch_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该批次已绑定其他 Alibaba 店铺，不能直接切换目标店铺",
        )


@router.get("/alibaba/operations")
async def alibaba_operations() -> list[dict[str, Any]]:
    return [item.model_dump() for item in OPERATIONS.values()]


@router.get("/alibaba/listing-flow", response_model=OfficialListingFlowResponse)
async def get_official_listing_flow() -> OfficialListingFlowResponse:
    return official_listing_flow()


@router.get("/alibaba/listing-field-matrix", response_model=list[ListingFieldGroup])
async def get_listing_field_matrix() -> list[ListingFieldGroup]:
    return listing_field_groups()


def _active_store_id(user: AuthenticatedUser, database: Database) -> str:
    store = database.get_active_store(user.workspace_id)
    if store is None or store.expired:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="当前工作区没有可用的 Alibaba 店铺",
        )
    return store.id


def _require_listing_feature(
    user: AuthenticatedUser,
    database: Database,
    feature: str,
) -> None:
    if not database.get_listing_feature_flags(user.workspace_id).get(feature, False):
        raise HTTPException(status_code=409, detail=f"{feature} 功能当前已关闭")


@router.get("/products/official-listing/templates", response_model=list[ListingTemplateResult])
async def list_listing_templates(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
    category_id: str | None = None,
) -> list[dict[str, object]]:
    store_id = _active_store_id(user, database)
    return database.list_listing_templates(user.workspace_id, store_id, category_id)


@router.post(
    "/products/official-listing/templates",
    response_model=ListingTemplateResult,
    status_code=status.HTTP_201_CREATED,
)
async def create_listing_template(
    request: ListingTemplateCreateRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> dict[str, object]:
    _require_listing_feature(user, database, "templates")
    if not request.fields:
        raise HTTPException(status_code=422, detail="模板至少需要一个字段")
    store_id = _active_store_id(user, database)
    return database.create_listing_template(
        workspace_id=user.workspace_id,
        store_connection_id=store_id,
        name=request.name,
        category_id=request.category_id,
        fields=request.fields,
    )


@router.put(
    "/products/official-listing/templates/{template_id}",
    response_model=ListingTemplateResult,
)
async def update_listing_template(
    template_id: str,
    request: ListingTemplateUpdateRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> dict[str, object]:
    _require_listing_feature(user, database, "templates")
    store_id = _active_store_id(user, database)
    template = database.update_listing_template(
        workspace_id=user.workspace_id,
        store_connection_id=store_id,
        template_id=template_id,
        name=request.name,
        category_id=request.category_id,
        fields=request.fields,
    )
    if template is None:
        raise HTTPException(status_code=404, detail="模板不存在")
    return template


@router.delete(
    "/products/official-listing/templates/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_listing_template(
    template_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> None:
    _require_listing_feature(user, database, "templates")
    store_id = _active_store_id(user, database)
    if not database.delete_listing_template(user.workspace_id, store_id, template_id):
        raise HTTPException(status_code=404, detail="模板不存在")


@router.post(
    "/products/official-listing/templates/{template_id}/apply",
    response_model=ListingTemplateApplyResult,
)
async def apply_listing_template(
    template_id: str,
    request: ListingTemplateApplyRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> ListingTemplateApplyResult:
    _require_listing_feature(user, database, "templates")
    store_id = _active_store_id(user, database)
    template = database.get_listing_template(user.workspace_id, store_id, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="模板不存在")
    merged = dict(request.fields)
    raw_fields = template["fields"]
    if isinstance(raw_fields, dict):
        for field_path, raw_value in raw_fields.items():
            current = merged.get(str(field_path))
            if current is not None and current.value not in (None, "", []):
                continue
            value = raw_value.get("value") if isinstance(raw_value, dict) else raw_value
            merged[str(field_path)] = DraftField(
                value=value,
                source=FieldSource.USER_PROVIDED,
                evidence=f"模板：{template['name']}",
            )
    tasks = build_field_tasks(request.schema_data, merged, request.account_defaults)
    if database.get_listing_feature_flags(user.workspace_id)["metrics"]:
        database.record_listing_metric_event(
            workspace_id=user.workspace_id,
            event_type="template_applied",
            payload={"template_id": template_id, "field_count": len(merged)},
        )
    return ListingTemplateApplyResult(fields=merged, tasks=tasks)


@router.post(
    "/products/official-listing/import",
    response_model=ListingImportResult,
)
async def import_listing_products(
    file: Annotated[UploadFile, File()],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> ListingImportResult:
    flags = database.get_listing_feature_flags(user.workspace_id)
    if not flags["imports"]:
        raise HTTPException(status_code=409, detail="商品导入功能当前已关闭")
    data = await file.read(get_settings().max_upload_bytes + 1)
    if len(data) > get_settings().max_upload_bytes:
        raise HTTPException(status_code=413, detail="导入文件超过大小限制")
    try:
        result = parse_listing_import(file.filename or "", data)
    except (ValueError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if flags["metrics"]:
        database.record_listing_metric_event(
            workspace_id=user.workspace_id,
            event_type="import_completed",
            payload={
                "format": result.format,
                "rows": len(result.rows),
                "errors": len(result.errors),
            },
        )
    return result


@router.get("/products/official-listing/feature-flags", response_model=ListingFeatureFlags)
async def get_listing_feature_flags(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> dict[str, bool]:
    return database.get_listing_feature_flags(user.workspace_id)


@router.patch("/products/official-listing/feature-flags", response_model=ListingFeatureFlags)
async def update_listing_feature_flags(
    request: ListingFeatureFlagsUpdate,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> dict[str, bool]:
    return database.update_listing_feature_flags(
        user.workspace_id,
        request.model_dump(exclude_none=True),
    )


@router.post(
    "/products/official-listing/metrics/events",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def record_listing_metric_event(
    request: ListingMetricEventRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> None:
    if database.get_listing_feature_flags(user.workspace_id)["metrics"]:
        database.record_listing_metric_event(
            workspace_id=user.workspace_id,
            event_type=request.event_type,
            batch_id=request.batch_id,
            reference=request.reference,
            duration_ms=request.duration_ms,
            reason=request.reason,
            payload=request.payload,
        )


@router.get("/products/official-listing/metrics", response_model=ListingMetricsResult)
async def get_listing_metrics(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> dict[str, object]:
    return database.get_listing_metrics(user.workspace_id)


async def _load_category_level(
    client: AlibabaClient,
    category_id: str,
) -> tuple[CategoryRecord | None, list[CategoryRecord]]:
    payload = await _alibaba_call(client, "category_get", {"cat_id": category_id})
    records = extract_category_records(payload)
    parent, children, missing_child_ids = category_children(category_id, records)
    if missing_child_ids:
        semaphore = asyncio.Semaphore(5)

        async def load_child(child_id: str) -> dict[str, Any]:
            async with semaphore:
                return await _alibaba_call(client, "category_get", {"cat_id": child_id})

        child_payloads = await asyncio.gather(
            *[load_child(child_id) for child_id in missing_child_ids]
        )
        for child_id, child_payload in zip(missing_child_ids, child_payloads, strict=True):
            child_records = extract_category_records(child_payload)
            child = next(
                (record for record in child_records if record["id"] == child_id),
                None,
            )
            if child is not None:
                children.append(child)

    unique_children = {
        child["id"]: child
        for child in children
        if child["id"] != category_id
    }
    if category_id == "0" and not unique_children:
        logger.warning(
            "Alibaba category tree diagnostics category_id=%s payload_type=%s "
            "top_level_keys=%s records=%d parent_found=%s children=%d "
            "missing_child_ids=%d result=%d",
            category_id,
            type(payload).__name__,
            sorted(str(key) for key in payload) if isinstance(payload, Mapping) else [],
            len(records),
            parent is not None,
            len(children),
            len(missing_child_ids),
            len(unique_children),
        )
        raise HTTPException(
            status_code=502,
            detail="Alibaba 未返回可识别的一级类目，请稍后重试或联系管理员检查类目接口权限",
        )
    return parent, sorted(unique_children.values(), key=lambda item: item["name"].casefold())


@router.get("/alibaba/categories/{category_id}/children")
async def get_category_children(
    category_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    parent, children = await _load_category_level(client, category_id)
    return {"parent": parent, "categories": children}


@router.post(
    "/alibaba/categories/recommend",
    response_model=CategoryRecommendationResult,
)
async def recommend_categories(
    request: CategoryRecommendationRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    ai_client: Annotated[AIClient, Depends(get_ai_client)],
) -> CategoryRecommendationResult:
    warning: str | None = None

    async def load_children(category_id: str) -> list[CategoryRecord]:
        _, children = await _load_category_level(client, category_id)
        return children

    async def rank_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        nonlocal warning
        try:
            return await ai_client.rank_category_candidates(
                title=request.title,
                keywords=request.keywords,
                category_hint=request.category_hint,
                visible_traits=request.visible_traits,
                candidates=candidates,
            )
        except AIProviderError:
            warning = "AI 类目排序暂不可用，当前结果已切换为关键词匹配；请人工核对后确认。"
            return []

    recommendations, strategy = await recommend_category_paths(
        load_children=load_children,
        rank_candidates=rank_candidates,
        search_text=" ".join(
            [request.title, request.category_hint, *request.keywords, *request.visible_traits]
        ),
    )
    return CategoryRecommendationResult.model_validate(
        {
            "recommendations": recommendations,
            "strategy": strategy,
            "warning": warning,
        }
    )


@router.get("/alibaba/categories/{category_id}")
async def get_category(
    category_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(client, "category_get", {"cat_id": category_id})


@router.get("/alibaba/products")
async def list_products(
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    current_page: int = 1,
    page_size: int = 30,
    subject: str | None = None,
    category_id: str | None = None,
) -> dict[str, Any]:
    parameters: dict[str, Any] = {
        "current_page": current_page,
        "page_size": page_size,
        "language": "ENGLISH",
    }
    if subject:
        parameters["subject"] = subject
    if category_id:
        parameters["category_id"] = category_id
    return await _alibaba_call(client, "product_list", parameters)


def _schema_get_parameters(category_id: str, language: str) -> dict[str, Any]:
    return {
        "param_product_top_publish_request": {
            "cat_id": category_id,
            "language": language,
        }
    }


@router.get("/alibaba/categories/{category_id}/schema")
async def get_schema(
    category_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    language: str = "en_US",
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "schema_get",
        _schema_get_parameters(category_id, language),
    )


@router.post("/alibaba/categories/schema-level")
async def get_category_schema_level(
    request: AlibabaSchemaRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "category_schema_level_get",
        {
            "cat_id": request.category_id,
            "language": request.language,
            "xml": request.xml,
        },
    )


@router.post("/alibaba/products/drafts/render")
async def render_draft(
    request: AlibabaDraftRenderRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "draft_render",
        {
            "language": request.language,
            "cat_id": request.category_id,
            "product_id": request.product_id,
        },
    )


@router.get("/alibaba/products/{product_id}")
async def get_product(
    product_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "product_get",
        {"product_get_request": {"productId": product_id}},
    )


@router.get("/alibaba/products/{product_id}/score")
async def get_product_score(
    product_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(client, "product_score", {"product_id": product_id})


@router.get("/alibaba/products/{product_id}/inventory")
async def get_product_inventory(
    product_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "inventory_get",
        {"product_id": product_id, "language": "ENGLISH"},
    )


@router.put("/alibaba/products/{product_id}/inventory")
async def update_product_inventory(
    product_id: str,
    request: AlibabaInventoryUpdateRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "inventory_update",
        {
            "product_id": product_id,
            "inventory_list": [
                {
                    "sku_id": request.sku_id,
                    "inventory": request.inventory,
                    "inventory_code": request.inventory_code,
                }
            ],
        },
    )


@router.patch("/alibaba/products/{product_id}/display")
async def update_product_display(
    product_id: str,
    request: AlibabaDisplayUpdateRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "display_update",
        {
            "new_display": "Y" if request.display else "N",
            "product_id_list": [product_id],
        },
    )


@router.patch("/alibaba/products/{product_id}/schema")
async def update_product_schema(
    product_id: str,
    request: AlibabaSchemaUpdateRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "schema_update",
        {
            "xml": request.xml,
            "product_id": product_id,
            "cat_id": request.category_id,
            "language": request.language,
        },
    )


@router.post("/alibaba/schemas/parse", response_model=SchemaParseResult)
async def parse_schema(request: SchemaParseRequest) -> SchemaParseResult:
    try:
        return parse_schema_data(request.schema_data)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/alibaba/schemas/build", response_model=SchemaBuildResult)
async def build_schema(request: SchemaBuildRequest) -> SchemaBuildResult:
    try:
        return build_schema_xml(request.schema_data, request.values)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/alibaba/products/drafts")
async def create_draft(
    request: AlibabaSchemaRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    try:
        xml = _validated_submission_xml(request.xml)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await _alibaba_call(
        client,
        "draft_create",
        {
            "param_product_top_publish_request": {
                "language": request.language,
                "cat_id": request.category_id,
                "xml": xml,
            }
        },
    )


@router.post("/alibaba/products/batch/drafts", response_model=list[AlibabaBatchResult])
async def create_batch_drafts(
    request: AlibabaBatchRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> list[AlibabaBatchResult]:
    _bind_batch_to_active_store(request.batch_id, user, database)
    return await _batch_alibaba_call(client, "draft_create", request)


@router.post("/alibaba/products/publish")
async def publish_product(
    request: AlibabaPublishRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    if not request.confirmed_by_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Formal publishing requires confirmed_by_user=true",
        )
    try:
        xml = _validated_submission_xml(request.xml)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await _alibaba_call(
        client,
        "publish",
        {
            "publish_request": {
                "language": request.language,
                "cat_id": request.category_id,
                "xml": xml,
            }
        },
    )


@router.post("/alibaba/products/batch/publish", response_model=list[AlibabaBatchResult])
async def publish_batch_products(
    request: AlibabaBatchPublishRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> list[AlibabaBatchResult]:
    if not request.confirmed_by_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Batch publishing requires confirmed_by_user=true",
        )
    _bind_batch_to_active_store(request.batch_id, user, database)
    return await _batch_alibaba_call(client, "publish", request)


@router.post("/alibaba/photo-bank/images")
async def upload_photo(
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    image: Annotated[UploadFile, File(...)],
    group_id: Annotated[str, Form(...)],
) -> dict[str, Any]:
    content = await image.read()
    _validate_upload(image, content)
    return await _alibaba_call(
        client,
        "photo_upload",
        {"file_name": image.filename or "image", "group_id": group_id},
        files={
            "image_bytes": (
                image.filename or "image",
                content,
                image.content_type or "image/jpeg",
            )
        },
    )


@router.get("/alibaba/photo-bank/groups")
async def list_photo_groups(
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    current_page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "photo_group_list",
        {"request": {"currentPage": current_page, "pageSize": page_size}},
    )


@router.get("/alibaba/product-groups")
async def list_product_groups(
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "product_group_get",
        {"group_id": -1, "extra_context": "{}"},
    )


@router.get("/alibaba/photo-bank/images")
async def list_photos(
    group_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    current_page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "photo_list",
        {
            "groupId": group_id,
            "currentPage": current_page,
            "pageSize": page_size,
        },
    )


@router.post("/products/analyze-image", response_model=ProductImageAnalysis)
async def analyze_product_image(
    ai_client: Annotated[AIClient, Depends(get_ai_client)],
    images: Annotated[list[UploadFile] | None, File()] = None,
    image: Annotated[UploadFile | None, File()] = None,
    known_facts: Annotated[str, Form()] = "{}",
    category_hint: Annotated[str | None, Form()] = None,
    schema_data: Annotated[str | None, Form()] = None,
) -> ProductImageAnalysis:
    uploads = images or ([image] if image else [])
    if not uploads:
        raise HTTPException(status_code=422, detail="at least one product image is required")
    if len(uploads) > get_settings().max_product_images:
        raise HTTPException(
            status_code=422,
            detail=f"a product can contain at most {get_settings().max_product_images} images",
        )
    image_payloads: list[tuple[bytes, str]] = []
    for upload in uploads:
        content = await upload.read()
        _validate_upload(upload, content)
        image_payloads.append((content, upload.content_type or "image/jpeg"))
    try:
        parsed_facts = json.loads(known_facts)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="known_facts must be a JSON object") from exc
    if not isinstance(parsed_facts, dict):
        raise HTTPException(status_code=422, detail="known_facts must be a JSON object")
    field_guidance = _field_guidance_prompt(schema_data)
    try:
        return await ai_client.analyze_product_images(
            image_payloads,
            parsed_facts,
            category_hint,
            field_guidance,
        )
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post(
    "/products/translate-content",
    response_model=ProductContentTranslationResponse,
)
async def translate_product_content(
    request: ProductContentTranslationRequest,
    ai_client: Annotated[AIClient, Depends(get_ai_client)],
) -> ProductContentTranslationResponse:
    try:
        return await ai_client.translate_product_content(request)
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _field_guidance_prompt(schema_data: str | None) -> str | None:
    if not schema_data or not schema_data.strip():
        return None
    try:
        guidance = build_schema_guidance(schema_data)
    except SchemaParseError:
        return None
    prompt = render_guidance_prompt(guidance)
    return prompt or None


@router.get(
    "/alibaba/categories/{category_id}/schema/guidance",
    response_model=SchemaGuidanceResult,
)
async def get_schema_guidance(
    category_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    language: str = "en_US",
) -> SchemaGuidanceResult:
    schema = await _alibaba_call(
        client,
        "schema_get",
        _schema_get_parameters(category_id, language),
    )
    try:
        return build_schema_guidance(schema)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/alibaba/schemas/guidance", response_model=SchemaGuidanceResult)
async def build_guidance(request: SchemaParseRequest) -> SchemaGuidanceResult:
    try:
        return build_schema_guidance(request.schema_data)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/products/official-listing/tasks", response_model=FieldTaskResult)
async def build_official_listing_tasks(request: FieldTaskRequest) -> FieldTaskResult:
    try:
        return build_field_tasks(
            request.schema_data,
            request.fields,
            request.account_defaults,
            request.category_id,
        )
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/products/official-listing/options",
    response_model=SchemaGuidanceResult,
)
async def load_official_listing_options(
    request: AsyncSchemaOptionsRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> SchemaGuidanceResult:
    try:
        if request.schema_data is None:
            raise HTTPException(status_code=422, detail="schema_data is required")
        guidance = build_schema_guidance(request.schema_data)
        target = next(
            (
                field
                for field in guidance.ai_fillable_fields + guidance.manual_fact_fields
                if field.field == request.field_path
            ),
            None,
        )
        if target is None or not target.async_options or not target.async_query_method:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The requested field does not declare asyncQueryRule",
            )
        if "subprop.schema.get" not in target.async_query_method.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Unsupported Alibaba async option query method",
            )
        effective = effective_listing_fields(request.fields, request.account_defaults)
        built = build_schema_xml(
            request.schema_data,
            {field_path: field.value for field_path, field in effective.items()},
        )
        response = await _alibaba_call(
            client,
            "category_schema_level_get",
            {
                "cat_id": request.category_id,
                "language": request.language,
                "xml": built.xml,
            },
        )
        return build_schema_guidance(response)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/products/official-listing/fields/confirm",
    response_model=FieldConfirmationResult,
)
async def confirm_official_listing_field(
    request: FieldConfirmationRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> FieldConfirmationResult:
    try:
        guidance = confirmable_ai_field(request.schema_data, request.field_path)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    category_confirmation = is_confirmable_category(request.field_path)
    if guidance is None and not category_confirmation:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only fields classified as ai_candidate can use the AI confirmation endpoint",
        )
    _bind_batch_to_active_store(request.batch_id, user, database)
    schema_payload = (
        request.schema_data
        if isinstance(request.schema_data, str)
        else json.dumps(request.schema_data, ensure_ascii=False, sort_keys=True)
    )
    confirmation = database.record_field_confirmation(
        workspace_id=user.workspace_id,
        batch_id=request.batch_id,
        reference=request.reference,
        field_path=guidance.field if guidance else "category_id",
        value=request.value,
        original_source=request.original_source,
        action=request.action,
        evidence=request.evidence,
        schema_fingerprint=hashlib.sha256(schema_payload.encode()).hexdigest(),
        confirmed_by_user_id=user.id,
    )
    if database.get_listing_feature_flags(user.workspace_id)["metrics"]:
        database.record_listing_metric_event(
            workspace_id=user.workspace_id,
            event_type="field_edited" if request.action == "edited" else "field_confirmed",
            batch_id=request.batch_id,
            reference=request.reference,
            payload={"field_path": guidance.field if guidance else "category_id"},
        )
    return FieldConfirmationResult(
        field_path=guidance.field if guidance else "category_id",
        field=DraftField(
            value=request.value,
            display_value_zh=request.display_value_zh,
            source=FieldSource.USER_CONFIRMED,
            confidence=request.confidence,
            requires_confirmation=False,
            evidence=request.evidence,
            confirmation_id=confirmation.id,
            confirmed_at=confirmation.created_at.isoformat(),
            confirmed_by=user.id,
        ),
    )


@router.post("/products/validate", response_model=ProductValidationResult)
async def validate_product(request: ProductValidationRequest) -> ProductValidationResult:
    try:
        required_fields = merge_schema_required_fields(
            request.schema_required_fields,
            request.schema_data,
        )
        manual_fields = manual_schema_fields(request.schema_data)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return validate_product_fields(
        request.fields,
        required_fields,
        manual_fields,
        request.account_defaults,
    )


@router.post("/products/official-listing/validate", response_model=OfficialListingValidationResult)
async def validate_official_listing(
    request: ProductValidationRequest,
) -> OfficialListingValidationResult:
    try:
        required_fields = merge_schema_required_fields(
            request.schema_required_fields,
            request.schema_data,
        )
        manual_fields = manual_schema_fields(request.schema_data)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    result = validate_product_fields(
        request.fields,
        required_fields,
        manual_fields,
        request.account_defaults,
    )
    effective = effective_listing_fields(request.fields, request.account_defaults)
    return OfficialListingValidationResult(
        ready_to_publish=result.ready_to_publish,
        missing_fields=result.missing_fields,
        invalid_ai_fields=result.invalid_ai_fields,
        invalid_default_fields=result.invalid_default_fields,
        confirmation_fields=result.confirmation_fields,
        schema_required_fields=required_fields,
        manual_confirmation_fields=manual_fields,
        checklist=build_official_checklist(effective, required_fields),
    )


@router.post(
    "/products/official-listing/prepare",
    response_model=OfficialListingPreparationResult,
)
async def prepare_official_listing(
    request: OfficialListingPrepareRequest,
) -> OfficialListingPreparationResult:
    try:
        return _prepare_official_listing(request)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/products/official-listing/drafts")
async def create_official_listing_draft(
    request: OfficialListingPrepareRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    prepared = _require_prepared_listing(request)
    return await _alibaba_call(
        client,
        "draft_create",
        {
            "param_product_top_publish_request": {
                "language": request.language,
                "cat_id": request.category_id,
                "xml": prepared.xml,
            }
        },
    )


@router.post(
    "/products/official-listing/batch/drafts",
    response_model=list[AlibabaBatchResult],
)
async def create_official_listing_batch_drafts(
    request: OfficialListingBatchRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> list[AlibabaBatchResult]:
    _bind_batch_to_active_store(request.batch_id, user, database)
    started_at = perf_counter()
    results = await _batch_official_listing_call(client, "draft_create", request)
    await _capture_draft_snapshots(client, request, results, user, database)
    duration_ms = round((perf_counter() - started_at) * 1000)
    if database.get_listing_feature_flags(user.workspace_id)["metrics"]:
        for result in results:
            database.record_listing_metric_event(
                workspace_id=user.workspace_id,
                event_type="draft_succeeded" if result.success else "draft_failed",
                batch_id=request.batch_id,
                reference=result.reference,
                duration_ms=duration_ms,
                reason=result.error,
            )
    return results


@router.get(
    "/products/official-listing/batches/{batch_id}/snapshots",
    response_model=list[DraftSnapshotResult],
)
async def list_official_listing_snapshots(
    batch_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> list[DraftSnapshotResult]:
    _bind_batch_to_active_store(batch_id, user, database)
    return [
        DraftSnapshotResult(
            id=snapshot.id,
            batch_id=snapshot.batch_id,
            reference=snapshot.reference,
            product_id=snapshot.product_id,
            request_fields=snapshot.request_fields,
            platform_response=snapshot.platform_response,
            differences=[
                DraftFieldDifference.model_validate(item) for item in snapshot.differences
            ],
            created_at=snapshot.created_at.isoformat(),
        )
        for snapshot in database.list_draft_snapshots(user.workspace_id, batch_id)
    ]


@router.post("/products/official-listing/publish")
async def publish_official_listing(
    request: OfficialListingPublishRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    if not request.confirmed_by_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Formal publishing requires confirmed_by_user=true",
        )
    prepared = _require_prepared_listing(request)
    return await _alibaba_call(
        client,
        "publish",
        {
            "publish_request": {
                "language": request.language,
                "cat_id": request.category_id,
                "xml": prepared.xml,
            }
        },
    )


@router.post(
    "/products/official-listing/batch/publish",
    response_model=list[AlibabaBatchResult],
)
async def publish_official_listing_batch(
    request: OfficialListingBatchPublishRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    database: Annotated[Database, Depends(get_database)],
) -> list[AlibabaBatchResult]:
    if not request.confirmed_by_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Batch publishing requires confirmed_by_user=true",
        )
    _bind_batch_to_active_store(request.batch_id, user, database)
    results = await _batch_official_listing_call(client, "publish", request)
    if database.get_listing_feature_flags(user.workspace_id)["metrics"]:
        for result in results:
            database.record_listing_metric_event(
                workspace_id=user.workspace_id,
                event_type="publish_succeeded" if result.success else "publish_failed",
                batch_id=request.batch_id,
                reference=result.reference,
                reason=result.error,
            )
    return results


@router.post("/images/generate")
async def generate_image(
    request: ImageGenerationRequest,
    ai_client: Annotated[AIClient, Depends(get_ai_client)],
) -> dict[str, Any]:
    try:
        return await ai_client.generate_image(request.prompt, request.size, request.count)
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _image_url(payload: object) -> str | None:
    if isinstance(payload, Mapping):
        url = payload.get("url")
        if isinstance(url, str) and url.startswith(("http://", "https://", "data:")):
            return url
        encoded = payload.get("b64_json")
        if isinstance(encoded, str) and encoded:
            return f"data:image/png;base64,{encoded}"
        for value in payload.values():
            found = _image_url(value)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = _image_url(value)
            if found:
                return found
    return None


@router.get("/images/prompt-templates", response_model=list[ImagePromptTemplate])
async def get_image_prompt_templates() -> list[ImagePromptTemplate]:
    return list_prompt_templates()


@router.post(
    "/products/{product_id}/image-plan",
    response_model=ProductImagePlanResponse,
)
async def plan_product_images(
    product_id: str,
    request: ProductImageGenerationRequest,
) -> ProductImagePlanResponse:
    if product_id != request.product_id:
        raise HTTPException(status_code=400, detail="商品 ID 与请求内容不一致")
    slots = [
        slot for slot in resolve_slots(request.slots) if slot not in set(request.existing_slots)
    ]
    return ProductImagePlanResponse(
        product_id=product_id,
        target_language=request.target_language,
        slots=[build_slot_plan(SLOT_TEMPLATES[slot], request) for slot in slots],
    )


@router.post(
    "/products/{product_id}/generate-images",
    response_model=ProductImageGenerationResponse,
)
async def generate_product_images(
    product_id: str,
    ai_client: Annotated[AIClient, Depends(get_ai_client)],
    request: Annotated[str, Form(...)],
    references: Annotated[list[UploadFile] | None, File()] = None,
    reference: Annotated[UploadFile | None, File()] = None,
) -> ProductImageGenerationResponse:
    try:
        parsed = ProductImageGenerationRequest.model_validate_json(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="request 不是有效的生图参数") from exc
    if product_id != parsed.product_id:
        raise HTTPException(status_code=400, detail="商品 ID 与请求内容不一致")
    uploads = references or ([reference] if reference else [])
    if not uploads:
        raise HTTPException(status_code=422, detail="至少需要一张参考图")
    if len(uploads) > get_settings().max_product_images:
        raise HTTPException(
            status_code=422,
            detail=f"参考图最多 {get_settings().max_product_images} 张",
        )
    # Fall back to the primary reference only when multi-reference is disabled or the
    # provider is not expected to support multiple reference images.
    if not get_settings().image_multi_reference:
        uploads = uploads[:1]
    reference_payloads: list[tuple[bytes, str, str]] = []
    for upload in uploads:
        content = await upload.read()
        _validate_upload(upload, content)
        reference_payloads.append(
            (
                content,
                upload.filename or "reference-image",
                upload.content_type or "image/jpeg",
            )
        )
    # Skip slots the merchant already has, so generation only fills the gaps.
    existing_slots = set(parsed.existing_slots)
    slots = [slot for slot in resolve_slots(parsed.slots) if slot not in existing_slots]

    async def generate_slot(slot: ImageSlot) -> ProductImageCandidate:
        template = SLOT_TEMPLATES[slot]
        plan = build_slot_plan(template, parsed)
        if not plan.can_generate:
            missing_labels = "、".join(item.label for item in plan.missing_user_inputs)
            return ProductImageCandidate(
                slot=slot,
                label=template.label,
                can_generate=False,
                missing_user_inputs=plan.missing_user_inputs,
                error=f"缺少生成所需信息：{missing_labels}，请先补齐后再生成。",
            )
        try:
            result = await ai_client.edit_product_image(
                reference_payloads,
                build_slot_prompt(template, parsed),
                "1024x1024",
                1,
            )
            image_url = _image_url(result.get("data"))
            if image_url is None:
                return ProductImageCandidate(
                    slot=slot,
                    label=template.label,
                    error="图片服务未返回可用图片地址",
                )
            return ProductImageCandidate(
                slot=slot,
                label=template.label,
                image_url=image_url,
            )
        except (AIProviderError, HTTPError, ValueError, TypeError) as exc:
            return ProductImageCandidate(slot=slot, label=template.label, error=str(exc))

    # Image providers are substantially more capacity-sensitive than text APIs. Generate
    # slots sequentially to avoid a merchant action creating a burst of large edit jobs.
    candidates = [await generate_slot(slot) for slot in slots]
    return ProductImageGenerationResponse(product_id=product_id, candidates=list(candidates))


@router.post("/images/generate-from-product")
async def generate_image_from_product(
    ai_client: Annotated[AIClient, Depends(get_ai_client)],
    image: Annotated[UploadFile, File(...)],
    prompt: Annotated[str, Form(min_length=3, max_length=4000)],
    size: Annotated[str, Form()] = "1024x1024",
    count: Annotated[int, Form(ge=1, le=4)] = 1,
) -> dict[str, Any]:
    content = await image.read()
    _validate_upload(image, content)
    try:
        return await ai_client.edit_product_image(
            [(content, image.filename or "product-image", image.content_type or "image/jpeg")],
            prompt,
            size,
            count,
        )
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


async def _alibaba_call(
    client: AlibabaClient,
    operation_key: str,
    parameters: dict[str, Any],
    files: dict[str, tuple[str, bytes, str]] | None = None,
) -> dict[str, Any]:
    try:
        return await client.call(OPERATIONS[operation_key].operation, parameters, files)
    except AlibabaConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except AlibabaAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


async def _batch_alibaba_call(
    client: AlibabaClient,
    operation_key: str,
    request: AlibabaBatchRequest,
) -> list[AlibabaBatchResult]:
    semaphore = asyncio.Semaphore(request.concurrency)

    async def process_item(index: int) -> tuple[int, AlibabaBatchResult]:
        item = request.items[index]
        async with semaphore:
            try:
                xml = _validated_submission_xml(item.xml)
                response = await client.call(
                    OPERATIONS[operation_key].operation,
                    {
                        (
                            "param_product_top_publish_request"
                            if operation_key == "draft_create"
                            else "publish_request"
                        ): {
                            "language": item.language,
                            "cat_id": item.category_id,
                            "xml": xml,
                        }
                    },
                )
                result = AlibabaBatchResult(
                    reference=item.reference,
                    success=True,
                    response=response,
                )
            except (AlibabaAPIError, SchemaParseError) as exc:
                result = AlibabaBatchResult(
                    reference=item.reference,
                    success=False,
                    error=str(exc),
                )
            return index, result

    indexed_results = await asyncio.gather(
        *(process_item(index) for index in range(len(request.items)))
    )
    return [result for _, result in sorted(indexed_results)]


def _validated_submission_xml(xml: str) -> str:
    result = validate_filled_schema_xml(xml)
    if result.ready_to_submit:
        return result.xml
    details = "; ".join(f"{issue.field}: {issue.message}" for issue in result.errors)
    raise SchemaParseError(f"Alibaba Schema validation failed: {details}")


def _prepare_official_listing(
    request: OfficialListingPrepareRequest,
) -> OfficialListingPreparationResult:
    parsed = parse_schema_data(request.schema_data)
    required_fields = merge_schema_required_fields(
        request.schema_required_fields,
        request.schema_data,
    )
    manual_fields = manual_schema_fields(request.schema_data)
    validation = validate_product_fields(
        request.fields,
        required_fields,
        manual_fields,
        request.account_defaults,
    )
    effective = effective_listing_fields(request.fields, request.account_defaults)
    category = get_listing_field(effective, "category_id") or get_listing_field(
        effective,
        "cat_id",
    )
    category_mismatch = (
        category is not None
        and category.value not in (None, "")
        and str(category.value) != request.category_id
    )
    invalid_defaults = list(validation.invalid_default_fields)
    if category_mismatch:
        invalid_defaults.append("category_id")
    values = _schema_values(parsed.fields, effective)
    schema = build_schema_xml(request.schema_data, values)
    ready = validation.ready_to_publish and not category_mismatch and schema.ready_to_submit
    return OfficialListingPreparationResult(
        ready_to_publish=ready,
        ready_to_draft=ready,
        missing_fields=validation.missing_fields,
        invalid_ai_fields=validation.invalid_ai_fields,
        invalid_default_fields=sorted(set(invalid_defaults)),
        confirmation_fields=validation.confirmation_fields,
        schema_required_fields=required_fields,
        manual_confirmation_fields=manual_fields,
        checklist=build_official_checklist(effective, required_fields),
        xml=schema.xml if schema.ready_to_submit else None,
        schema_errors=schema.errors,
        schema_warnings=schema.warnings,
    )


def _schema_values(
    fields: list[ParsedSchemaField],
    effective: dict[str, DraftField],
) -> dict[str, object]:
    values: dict[str, object] = {}
    for field in fields:
        value = _schema_field_value(field, effective, [])
        if value not in (None, "", [], {}):
            values[field.id] = value
    return values


def _schema_field_value(
    field: ParsedSchemaField,
    effective: dict[str, DraftField],
    parent_path: list[str],
) -> object | None:
    path = [*parent_path, field.id]
    path_key = ".".join(part for part in path if part)
    supplied = get_listing_field(effective, path_key)
    if supplied is not None and supplied.value not in (None, "", [], {}):
        return supplied.value
    child_values: dict[str, object] = {}
    for child in field.children:
        value = _schema_field_value(child, effective, path)
        if value not in (None, "", [], {}):
            child_values[child.id] = value
    if not child_values:
        return None
    if field.type == "multiComplex":
        return [child_values]
    return child_values


def _require_prepared_listing(
    request: OfficialListingPrepareRequest,
) -> OfficialListingPreparationResult:
    try:
        prepared = _prepare_official_listing(request)
    except SchemaParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if prepared.ready_to_draft and prepared.xml is not None:
        return prepared
    raise HTTPException(
        status_code=422,
        detail={
            "message": "Official listing is not ready for an Alibaba write operation",
            "missing_fields": prepared.missing_fields,
            "invalid_ai_fields": prepared.invalid_ai_fields,
            "invalid_default_fields": prepared.invalid_default_fields,
            "confirmation_fields": prepared.confirmation_fields,
            "schema_errors": [item.model_dump() for item in prepared.schema_errors],
        },
    )


async def _batch_official_listing_call(
    client: AlibabaClient,
    operation_key: str,
    request: OfficialListingBatchRequest,
) -> list[AlibabaBatchResult]:
    semaphore = asyncio.Semaphore(request.concurrency)

    async def process_item(index: int) -> tuple[int, AlibabaBatchResult]:
        item = request.items[index]
        async with semaphore:
            try:
                prepared = _prepare_official_listing(item)
                if not prepared.ready_to_draft or prepared.xml is None:
                    return index, AlibabaBatchResult(
                        reference=item.reference,
                        success=False,
                        error=_preparation_error(prepared),
                    )
                response = await client.call(
                    OPERATIONS[operation_key].operation,
                    {
                        (
                            "param_product_top_publish_request"
                            if operation_key == "draft_create"
                            else "publish_request"
                        ): {
                            "language": item.language,
                            "cat_id": item.category_id,
                            "xml": prepared.xml,
                        }
                    },
                )
                return index, AlibabaBatchResult(
                    reference=item.reference,
                    success=True,
                    response=response,
                )
            except (AlibabaAPIError, SchemaParseError) as exc:
                return index, AlibabaBatchResult(
                    reference=item.reference,
                    success=False,
                    error=str(exc),
                )

    indexed_results = await asyncio.gather(
        *(process_item(index) for index in range(len(request.items)))
    )
    return [result for _, result in sorted(indexed_results)]


async def _capture_draft_snapshots(
    client: AlibabaClient,
    request: OfficialListingBatchRequest,
    results: list[AlibabaBatchResult],
    user: AuthenticatedUser,
    database: Database,
) -> None:
    items = {item.reference: item for item in request.items}
    for result in results:
        if not result.success or result.response is None:
            continue
        item = items[result.reference]
        product_id = _find_product_id(result.response)
        platform_response = result.response
        readback_error: str | None = None
        if product_id:
            try:
                platform_response = await client.call(
                    OPERATIONS["draft_render"].operation,
                    {
                        "language": item.language,
                        "cat_id": item.category_id,
                        "product_id": product_id,
                    },
                )
            except AlibabaAPIError as exc:
                readback_error = str(exc)
        differences = _field_differences(item.fields, platform_response)
        enriched_response = {
            **result.response,
            "_readback": platform_response,
            "_differences": differences,
        }
        if readback_error:
            enriched_response["_readback_error"] = readback_error
        result.response = enriched_response
        database.save_draft_snapshot(
            workspace_id=user.workspace_id,
            batch_id=request.batch_id,
            reference=item.reference,
            product_id=product_id,
            request_fields={
                field_path: field.model_dump(mode="json")
                for field_path, field in item.fields.items()
            },
            platform_response=platform_response,
            differences=differences,
        )


def _find_product_id(payload: object) -> str | None:
    if isinstance(payload, Mapping):
        for key, value in payload.items():
            compact = "".join(char.lower() for char in str(key) if char.isalnum())
            if compact in {"productid", "productidlist"}:
                if isinstance(value, list) and value:
                    return str(value[0])
                if value not in (None, ""):
                    return str(value)
        for value in payload.values():
            found = _find_product_id(value)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = _find_product_id(value)
            if found:
                return found
    return None


def _field_differences(
    fields: dict[str, DraftField],
    platform_response: dict[str, Any],
) -> list[dict[str, Any]]:
    platform_values = _flatten_response(platform_response)
    differences: list[dict[str, Any]] = []
    for field_path, field in fields.items():
        candidates = {
            _compact_comparison_key(field_path),
            _compact_comparison_key(field_path.rsplit(".", 1)[-1]),
        }
        platform_value = next(
            (value for key, value in platform_values.items() if key in candidates),
            None,
        )
        if platform_value is None:
            continue
        status_value = (
            "matched"
            if _comparable_value(field.value) == _comparable_value(platform_value)
            else "changed"
        )
        differences.append(
            {
                "field_path": field_path,
                "local_value": field.value,
                "platform_value": platform_value,
                "status": status_value,
            }
        )
    return differences


def _flatten_response(payload: object) -> dict[str, object]:
    flattened: dict[str, object] = {}

    def visit(value: object) -> None:
        if isinstance(value, Mapping):
            for key, child in value.items():
                if isinstance(child, Mapping | list):
                    visit(child)
                else:
                    flattened[_compact_comparison_key(str(key))] = child
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(payload)
    return flattened


def _compact_comparison_key(value: str) -> str:
    return "".join(char.lower() for char in value if char.isalnum())


def _comparable_value(value: object) -> str:
    if isinstance(value, dict | list):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return str(value).strip()


def _preparation_error(prepared: OfficialListingPreparationResult) -> str:
    return json.dumps(
        {
            "missing_fields": prepared.missing_fields,
            "invalid_ai_fields": prepared.invalid_ai_fields,
            "invalid_default_fields": prepared.invalid_default_fields,
            "confirmation_fields": prepared.confirmation_fields,
            "schema_errors": [item.model_dump() for item in prepared.schema_errors],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _validate_upload(image: UploadFile, content: bytes) -> None:
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Only image uploads are supported")
    if not content:
        raise HTTPException(status_code=422, detail="Image is empty")
    if len(content) > get_settings().max_upload_bytes:
        raise HTTPException(status_code=413, detail="Image is too large")
