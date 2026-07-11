from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


def _normalize_email(value: str) -> str:
    normalized = value.strip().lower()
    local, separator, domain = normalized.partition("@")
    if not separator or not local or "." not in domain:
        raise ValueError("请输入有效邮箱")
    return normalized


class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(min_length=2, max_length=80)
    workspace_name: str = Field(min_length=2, max_length=100)
    registration_code: str = Field(min_length=4, max_length=128)

    @field_validator("email")
    @classmethod
    def email_must_be_valid(cls, value: str) -> str:
        return _normalize_email(value)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def email_must_be_valid(cls, value: str) -> str:
        return _normalize_email(value)


class AuthUserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    workspace_id: str
    workspace_name: str


class FieldSource(StrEnum):
    IMAGE_EXTRACTED = "image_extracted"
    AI_GENERATED = "ai_generated"
    USER_PROVIDED = "user_provided"
    USER_CONFIRMED = "user_confirmed"
    BUSINESS_SYSTEM = "business_system"
    ACCOUNT_DEFAULT = "account_default"


class FieldScope(StrEnum):
    STORE = "store"
    PRODUCT = "product"


class FieldInputMode(StrEnum):
    AI_ASSISTED = "ai_assisted"
    TRUSTED_ONLY = "trusted_only"


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


class ListingFieldDefinition(ManualRequirement):
    aliases: list[str] = Field(default_factory=list)


class ListingFieldGroup(BaseModel):
    key: str
    label: str
    scope: FieldScope
    input_mode: FieldInputMode
    fields: list[ListingFieldDefinition]
    allowed_sources: list[FieldSource]
    confirmation_rule: str


class ProductImageAnalysis(BaseModel):
    observed_fields: dict[str, DraftField]
    generated_fields: dict[str, DraftField]
    category_suggestions: list[DraftField]
    manual_requirements: list[ManualRequirement]
    warnings: list[str]


class ProductValidationRequest(BaseModel):
    fields: dict[str, DraftField]
    account_defaults: dict[str, DraftField] = Field(default_factory=dict)
    schema_required_fields: list[str] = Field(default_factory=list)
    schema_data: dict[str, Any] | str | None = None


class ProductValidationResult(BaseModel):
    ready_to_publish: bool
    missing_fields: list[str]
    invalid_ai_fields: list[str]
    invalid_default_fields: list[str]
    confirmation_fields: list[str]


class ImageGenerationRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    size: str = "1024x1024"
    count: int = Field(default=1, ge=1, le=4)


class ProductImageFacts(BaseModel):
    brand: str = ""
    model: str = ""
    material: str = ""
    price: str = ""
    moq: str = ""
    stock: str = ""
    product_length: str = ""
    product_width: str = ""
    product_height: str = ""
    net_weight: str = ""
    package_length: str = ""
    package_width: str = ""
    package_height: str = ""
    gross_weight: str = ""
    units_per_carton: str = ""
    lead_time: str = ""
    origin: str = ""
    hs_code: str = ""
    certifications: list[str] = Field(default_factory=list)


class ProductImageGenerationRequest(BaseModel):
    product_id: str = Field(min_length=1, max_length=200)
    title: str = Field(max_length=500)
    category: str = Field(max_length=500)
    description: str = Field(max_length=4000)
    keywords: list[str] = Field(default_factory=list, max_length=20)
    facts: ProductImageFacts = Field(default_factory=ProductImageFacts)


class ProductImageCandidate(BaseModel):
    slot: Literal["main", "detail", "scenario", "specification", "packaging"]
    label: str
    image_url: str | None = None
    error: str | None = None


class ProductImageGenerationResponse(BaseModel):
    product_id: str
    candidates: list[ProductImageCandidate]


class AlibabaSchemaRequest(BaseModel):
    category_id: str
    xml: str = Field(min_length=20)
    language: Literal["en_US", "zh", "zh_TW"] = "en_US"


class AlibabaPublishRequest(AlibabaSchemaRequest):
    confirmed_by_user: bool = False


class AlibabaBatchItem(AlibabaSchemaRequest):
    reference: str = Field(min_length=1, max_length=200)


class AlibabaBatchRequest(BaseModel):
    batch_id: str = Field(min_length=8, max_length=100)
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
    field_groups: list[ListingFieldGroup]
    ai_can_generate: list[str]
    ai_requires_confirmation: list[str]
    must_be_user_or_business_system: list[str]


class OfficialListingPrepareRequest(ProductValidationRequest):
    category_id: str
    schema_data: dict[str, Any] | str
    language: Literal["en_US", "zh", "zh_TW"] = "en_US"


class OfficialListingPublishRequest(OfficialListingPrepareRequest):
    confirmed_by_user: bool = False


class OfficialListingBatchItem(OfficialListingPrepareRequest):
    reference: str = Field(min_length=1, max_length=200)


class OfficialListingBatchRequest(BaseModel):
    batch_id: str = Field(min_length=8, max_length=100)
    items: list[OfficialListingBatchItem] = Field(min_length=1, max_length=100)
    concurrency: int = Field(default=3, ge=1, le=10)

    @field_validator("items")
    @classmethod
    def official_references_must_be_unique(
        cls,
        items: list[OfficialListingBatchItem],
    ) -> list[OfficialListingBatchItem]:
        references = [item.reference for item in items]
        if len(references) != len(set(references)):
            raise ValueError("Batch item references must be unique")
        return items


class OfficialListingBatchPublishRequest(OfficialListingBatchRequest):
    confirmed_by_user: bool = False


class OfficialListingPreparationResult(OfficialListingValidationResult):
    ready_to_draft: bool
    xml: str | None = None
    schema_errors: list[SchemaValidationIssue]
    schema_warnings: list[SchemaValidationIssue]


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
