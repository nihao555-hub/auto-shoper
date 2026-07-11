from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


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
    schema_data: dict[str, Any] | str | None = None


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
    xml: str = Field(min_length=20)
    language: Literal["en_US", "zh", "zh_TW"] = "en_US"


class AlibabaPublishRequest(AlibabaSchemaRequest):
    confirmed_by_user: bool = False


class AlibabaBatchItem(AlibabaSchemaRequest):
    reference: str = Field(min_length=1, max_length=200)


class AlibabaBatchRequest(BaseModel):
    items: list[AlibabaBatchItem] = Field(min_length=1, max_length=100)
    concurrency: int = Field(default=3, ge=1, le=10)

    @field_validator("items")
    @classmethod
    def references_must_be_unique(
        cls,
        items: list[AlibabaBatchItem],
    ) -> list[AlibabaBatchItem]:
        references = [item.reference for item in items]
        if len(references) != len(set(references)):
            raise ValueError("Batch item references must be unique")
        return items


class AlibabaBatchPublishRequest(AlibabaBatchRequest):
    confirmed_by_user: bool = False


class AlibabaBatchResult(BaseModel):
    reference: str
    success: bool
    response: dict[str, Any] | None = None
    error: str | None = None


class AlibabaDraftRenderRequest(BaseModel):
    category_id: str
    product_id: str
    language: Literal["en_US", "zh", "zh_TW"] = "en_US"


class AlibabaSchemaUpdateRequest(BaseModel):
    category_id: str
    xml: str = Field(min_length=20)
    language: Literal["en_US", "zh", "zh_TW"] = "en_US"


class SchemaParseRequest(BaseModel):
    schema_data: dict[str, Any] | str


class SchemaBuildRequest(BaseModel):
    schema_data: dict[str, Any] | str
    values: dict[str, object]


class SchemaValidationIssue(BaseModel):
    field: str
    rule: str
    message: str


class SchemaBuildResult(BaseModel):
    xml: str
    ready_to_submit: bool
    errors: list[SchemaValidationIssue]
    warnings: list[SchemaValidationIssue]


class SchemaRule(BaseModel):
    name: str
    value: str | None = None
    ex_property: str | None = None
    unit: str | None = None


class SchemaOption(BaseModel):
    display_name: str | None = None
    value: str


class ParsedSchemaField(BaseModel):
    id: str
    name: str | None = None
    type: str | None = None
    path: list[str] = Field(default_factory=list)
    required: bool = False
    disabled: bool = False
    read_only: bool = False
    value_type: str | None = None
    rules: list[SchemaRule] = Field(default_factory=list)
    options: list[SchemaOption] = Field(default_factory=list)
    children: list["ParsedSchemaField"] = Field(default_factory=list)


class SchemaParseResult(BaseModel):
    fields: list[ParsedSchemaField]
    required_field_ids: list[str]
    manual_confirmation_field_ids: list[str]


class ListingChecklistItem(BaseModel):
    phase: str
    label: str
    required_fields: list[str]
    missing_fields: list[str]


class OfficialListingValidationResult(ProductValidationResult):
    schema_required_fields: list[str]
    manual_confirmation_fields: list[str]
    checklist: list[ListingChecklistItem]


class OfficialListingStep(BaseModel):
    order: int
    phase: str
    label: str
    actions: list[str]
    backend_endpoints: list[str]
    human_confirmation: bool


class OfficialListingFlowResponse(BaseModel):
    steps: list[OfficialListingStep]
    ai_can_generate: list[str]
    ai_requires_confirmation: list[str]
    must_be_user_or_business_system: list[str]


class AlibabaInventoryUpdateRequest(BaseModel):
    sku_id: str
    inventory: int = Field(ge=0)
    inventory_code: str = "CN_LOCAL_01"


class AlibabaDisplayUpdateRequest(BaseModel):
    display: bool


class AlibabaOperation(BaseModel):
    key: str
    operation: str
    purpose: str
    safety: str
    live_verification_required: bool = True
