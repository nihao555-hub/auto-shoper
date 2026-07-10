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
    AlibabaPublishRequest,
    AlibabaSchemaRequest,
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


@router.get("/alibaba/categories/{category_id}/schema")
async def get_schema(
    category_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(client, "schema_get", {"cat_id": category_id})


@router.get("/alibaba/products/{product_id}")
async def get_product(
    product_id: str,
    client: Annotated[AlibabaClient, Depends(get_alibaba_client)],
) -> dict[str, Any]:
    return await _alibaba_call(client, "product_get", {"product_id": product_id})


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


def _validate_upload(image: UploadFile, content: bytes) -> None:
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Only image uploads are supported")
    if not content:
        raise HTTPException(status_code=422, detail="Image is empty")
    if len(content) > get_settings().max_upload_bytes:
        raise HTTPException(status_code=413, detail="Image is too large")
