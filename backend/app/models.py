from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class FieldSource(StrEnum):
    IMAGE_EXTRACTED = "image_extracted"
    AI_GENERATED = "ai_generated"
    USER_PROVIDED = "user_provided"
    BUSINESS_SYSTEM = "business_system"


class DraftField(BaseModel):
    value: Any | None = None
    source: FieldSource
    confidence: float | None = Field(default=None, ge=0, le=1)
    requires_confirmation: bool = False
    evidence: str | None = None


class ManualRequirement(BaseModel):
    name: str
    label: str
    reason: str


class ProductImageAnalysis(BaseModel):
    observed_fields: dict[str, DraftField]
    generated_fields: dict[str, DraftField]
    category_suggestions: list[DraftField]
    manual_requirements: list[ManualRequirement]
    warnings: list[str]


class ProductValidationRequest(BaseModel):
    fields: dict[str, DraftField]
    schema_required_fields: list[str] = Field(default_factory=list)


class ProductValidationResult(BaseModel):
    ready_to_publish: bool
    missing_fields: list[str]
    invalid_ai_fields: list[str]
    confirmation_fields: list[str]


class ImageGenerationRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    size: str = "1024x1024"
    count: int = Field(default=1, ge=1, le=4)


class AlibabaSchemaRequest(BaseModel):
    category_id: str
    schema_data: dict[str, Any] | str


class AlibabaPublishRequest(AlibabaSchemaRequest):
    confirmed_by_user: bool = False


class AlibabaBatchItem(AlibabaSchemaRequest):
    reference: str | None = None


class AlibabaBatchRequest(BaseModel):
    items: list[AlibabaBatchItem] = Field(min_length=1, max_length=100)
    concurrency: int = Field(default=3, ge=1, le=10)


class AlibabaBatchPublishRequest(AlibabaBatchRequest):
    confirmed_by_user: bool = False


class AlibabaBatchResult(BaseModel):
    reference: str | None
    success: bool
    response: dict[str, Any] | None = None
    error: str | None = None


class AlibabaDraftRenderRequest(BaseModel):
    draft_id: str | None = None
    category_id: str | None = None
    product_id: str | None = None
    language: str = "en_US"

    @model_validator(mode="after")
    def validate_identifier(self) -> "AlibabaDraftRenderRequest":
        if self.draft_id or (self.category_id and self.product_id):
            return self
        raise ValueError("Provide draft_id, or both category_id and product_id")


class AlibabaSchemaUpdateRequest(BaseModel):
    schema_data: dict[str, Any] | str


class AlibabaInventoryUpdateRequest(BaseModel):
    sku_id: str
    amount: int | None = Field(default=None, ge=0)
    amount_diff: int | None = None

    @model_validator(mode="after")
    def validate_amount(self) -> "AlibabaInventoryUpdateRequest":
        if (self.amount is None) == (self.amount_diff is None):
            raise ValueError("Provide exactly one of amount or amount_diff")
        return self


class AlibabaDisplayUpdateRequest(BaseModel):
    display: bool


class AlibabaOperation(BaseModel):
    key: str
    operation: str
    purpose: str
    safety: str
    live_verification_required: bool = True
