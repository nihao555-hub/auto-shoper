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
    ProductImageAnalysis,
    ProductValidationRequest,
    ProductValidationResult,
)
from backend.app.services.field_policy import validate_product_fields

router = APIRouter(prefix="/api/v1")


@router.get("/capabilities")
async def capabilities() -> dict[str, Any]:
    return {
        "modules": {
            "alibaba_listing": True,
            "ai_images": True,
            "sales_expert": False,
        },
        "alibaba_credentials_configured": get_settings().has_alibaba_credentials,
    }


@router.get("/alibaba/operations")
async def alibaba_operations() -> list[dict[str, Any]]:
    return [item.model_dump() for item in OPERATIONS.values()]


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
) -> dict[str, Any]:
    return await _alibaba_call(client, "schema_get", {"cat_id": category_id})


@router.post("/alibaba/products/drafts/render")
async def render_draft(
    request: AlibabaDraftRenderRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    parameters: dict[str, Any] = {"language": request.language}
    if request.draft_id:
        parameters["draft_id"] = request.draft_id
    else:
        parameters["cat_id"] = request.category_id
        parameters["product_id"] = request.product_id
    return await _alibaba_call(
        client,
        "draft_render",
        parameters,
    )


@router.get("/alibaba/products/{product_id}")
async def get_product(
    product_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(client, "product_get", {"product_id": product_id})


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
        {"inventory_get_request": {"productId": product_id}},
    )


@router.put("/alibaba/products/{product_id}/inventory")
async def update_product_inventory(
    product_id: str,
    request: AlibabaInventoryUpdateRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    inventory: dict[str, int] = {}
    if request.amount is not None:
        inventory["amount"] = request.amount
    if request.amount_diff is not None:
        inventory["amountDiff"] = request.amount_diff
    return await _alibaba_call(
        client,
        "inventory_update",
        {
            "inventory_update_request": {
                "inventoryItems": [
                    {
                        "productId": product_id,
                        "skuId": request.sku_id,
                        "inventory": inventory,
                    }
                ]
            }
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
        {"request": {"productId": product_id, "display": request.display}},
    )


@router.patch("/alibaba/schemas/{schema_id}")
async def update_product_schema(
    schema_id: str,
    request: AlibabaSchemaUpdateRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "schema_update",
        {"schema_id": schema_id, "schema_data": request.schema_data},
    )


@router.post("/alibaba/products/drafts")
async def create_draft(
    request: AlibabaSchemaRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(
        client,
        "draft_create",
        {"cat_id": request.category_id, "schema_data": request.schema_data},
    )


@router.post("/alibaba/products/batch/drafts", response_model=list[AlibabaBatchResult])
async def create_batch_drafts(
    request: AlibabaBatchRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> list[AlibabaBatchResult]:
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
    return await _alibaba_call(
        client,
        "publish",
        {"cat_id": request.category_id, "schema_data": request.schema_data},
    )


@router.post("/alibaba/products/batch/publish", response_model=list[AlibabaBatchResult])
async def publish_batch_products(
    request: AlibabaBatchPublishRequest,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> list[AlibabaBatchResult]:
    if not request.confirmed_by_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Batch publishing requires confirmed_by_user=true",
        )
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
        {"request": {"groupId": group_id, "imageName": image.filename}},
        files={"file": (image.filename or "image", content, image.content_type or "image/jpeg")},
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
            "request": {
                "groupId": group_id,
                "currentPage": current_page,
                "pageSize": page_size,
            }
        },
    )


@router.post("/products/analyze-image", response_model=ProductImageAnalysis)
async def analyze_product_image(
    ai_client: Annotated[AIClient, Depends(get_ai_client)],
    image: Annotated[UploadFile, File(...)],
    known_facts: Annotated[str, Form()] = "{}",
    category_hint: Annotated[str | None, Form()] = None,
) -> ProductImageAnalysis:
    content = await image.read()
    _validate_upload(image, content)
    try:
        parsed_facts = json.loads(known_facts)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="known_facts must be a JSON object") from exc
    if not isinstance(parsed_facts, dict):
        raise HTTPException(status_code=422, detail="known_facts must be a JSON object")
    try:
        return await ai_client.analyze_product_image(
            content,
            image.content_type or "image/jpeg",
            parsed_facts,
            category_hint,
        )
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/products/validate", response_model=ProductValidationResult)
async def validate_product(request: ProductValidationRequest) -> ProductValidationResult:
    return validate_product_fields(request.fields, request.schema_required_fields)


@router.post("/images/generate")
async def generate_image(
    request: ImageGenerationRequest,
    ai_client: Annotated[AIClient, Depends(get_ai_client)],
) -> dict[str, Any]:
    try:
        return await ai_client.generate_image(request.prompt, request.size, request.count)
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
                response = await client.call(
                    OPERATIONS[operation_key].operation,
                    {"cat_id": item.category_id, "schema_data": item.schema_data},
                )
                result = AlibabaBatchResult(
                    reference=item.reference,
                    success=True,
                    response=response,
                )
            except AlibabaAPIError as exc:
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


def _validate_upload(image: UploadFile, content: bytes) -> None:
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Only image uploads are supported")
    if not content:
        raise HTTPException(status_code=422, detail="Image is empty")
    if len(content) > get_settings().max_upload_bytes:
        raise HTTPException(status_code=413, detail="Image is too large")
