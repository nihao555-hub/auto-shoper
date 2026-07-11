import asyncio
import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

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
    ImageGenerationRequest,
    ListingFieldGroup,
    OfficialListingBatchPublishRequest,
    OfficialListingBatchRequest,
    OfficialListingFlowResponse,
    OfficialListingPreparationResult,
    OfficialListingPrepareRequest,
    OfficialListingPublishRequest,
    OfficialListingValidationResult,
    ProductImageAnalysis,
    ProductValidationRequest,
    ProductValidationResult,
    SchemaBuildRequest,
    SchemaBuildResult,
    SchemaParseRequest,
    SchemaParseResult,
)
from backend.app.services.auth import get_current_user
from backend.app.services.field_policy import (
    effective_listing_fields,
    get_listing_field,
    validate_product_fields,
)
from backend.app.services.official_listing import (
    build_official_checklist,
    listing_field_groups,
    official_listing_flow,
)
from backend.app.services.schema_rules import (
    SchemaParseError,
    manual_schema_fields,
    merge_schema_required_fields,
    parse_schema_data,
)
from backend.app.services.schema_values import build_schema_xml, validate_filled_schema_xml

router = APIRouter(prefix="/api/v1")


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


@router.get("/alibaba/categories/{category_id}/schema")
async def get_schema(
    category_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
    language: str = "en_US",
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "schema_get",
        {"cat_id": category_id, "language": language},
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
    try:
        return await ai_client.analyze_product_images(
            image_payloads,
            parsed_facts,
            category_hint,
        )
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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
    return await _batch_official_listing_call(client, "draft_create", request)


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
    return await _batch_official_listing_call(client, "publish", request)


@router.post("/images/generate")
async def generate_image(
    request: ImageGenerationRequest,
    ai_client: Annotated[AIClient, Depends(get_ai_client)],
) -> dict[str, Any]:
    try:
        return await ai_client.generate_image(request.prompt, request.size, request.count)
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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
            content,
            image.filename or "product-image",
            image.content_type or "image/jpeg",
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
    details = "; ".join(
        f"{issue.field}: {issue.message}"
        for issue in result.errors
    )
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
    top_level_ids = {field.id for field in parsed.fields}
    values: dict[str, object] = {}
    for field_id in top_level_ids:
        field = get_listing_field(effective, field_id)
        if field is not None and field.value not in (None, "", [], {}):
            values[field_id] = field.value
    schema = build_schema_xml(request.schema_data, values)
    ready = (
        validation.ready_to_publish
        and not category_mismatch
        and schema.ready_to_submit
    )
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
