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
    display_value_zh: Any | None = None
    source: FieldSource
    confidence: float | None = Field(default=None, ge=0, le=1)
    requires_confirmation: bool = False
    evidence: str | None = None
    confirmation_id: str | None = None
    confirmed_at: str | None = None
    confirmed_by: str | None = None


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


class ProductContentTranslationRequest(BaseModel):
    source_language: str = Field(default="English", min_length=2, max_length=80)
    target_language_code: str = Field(min_length=2, max_length=20)
    target_language: str = Field(min_length=2, max_length=80)
    title: str = Field(min_length=1, max_length=500)
    keywords: list[str] = Field(default_factory=list, max_length=20)
    selling_points: list[str] = Field(default_factory=list, max_length=20)
    description: str = Field(default="", max_length=12000)


class ProductContentTranslationResponse(BaseModel):
    target_language_code: str
    target_language: str
    title: str
    keywords: list[str]
    selling_points: list[str]
    description: str


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


ImageSlot = Literal["main", "detail", "scenario", "specification", "packaging"]


class ProductImageGenerationRequest(BaseModel):
    product_id: str = Field(min_length=1, max_length=200)
    title: str = Field(max_length=500)
    category: str = Field(max_length=500)
    description: str = Field(max_length=4000)
    keywords: list[str] = Field(default_factory=list, max_length=20)
    facts: ProductImageFacts = Field(default_factory=ProductImageFacts)
    # Visible traits the image analysis observed on the source product (e.g. color,
    # shape, visible components). Used as identity anchors so the model preserves what
    # the reference image actually shows instead of improvising.
    visible_traits: list[str] = Field(default_factory=list, max_length=20)
    slots: list[ImageSlot] = Field(default_factory=list)
    existing_slots: list[ImageSlot] = Field(default_factory=list)
    target_language: Literal["en_US"] = "en_US"
    user_inputs: dict[str, str] = Field(default_factory=dict)
    extra_prompt: str = Field(default="", max_length=2000)


class ImagePromptTemplate(BaseModel):
    slot: ImageSlot
    label: str
    schema_field: str | None = None
    required: bool = False
    instruction: str


class ImageInputRequirement(BaseModel):
    key: str
    label: str
    description: str
    required: bool = True


class ImageSlotPlan(BaseModel):
    slot: ImageSlot
    label: str
    purpose: str
    required: bool = False
    can_generate: bool = True
    missing_user_inputs: list[ImageInputRequirement] = Field(default_factory=list)


class ProductImageCandidate(BaseModel):
    slot: ImageSlot
    label: str
    image_url: str | None = None
    error: str | None = None
    requires_confirmation: bool = True
    source_image_preservation_required: bool = True
    can_generate: bool = True
    missing_user_inputs: list[ImageInputRequirement] = Field(default_factory=list)


class ProductImageGenerationResponse(BaseModel):
    product_id: str
    candidates: list[ProductImageCandidate]


class ProductImagePlanResponse(BaseModel):
    product_id: str
    target_language: Literal["en_US"] = "en_US"
    slots: list[ImageSlotPlan]


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


class SchemaDependencyExpression(BaseModel):
    field_id: str
    value: str | None = None
    symbol: str


class SchemaDependencyGroup(BaseModel):
    operator: Literal["and", "or"] = "and"
    expressions: list[SchemaDependencyExpression] = Field(default_factory=list)


class SchemaOption(BaseModel):
    display_name: str | None = None
    value: str
    valid: bool = True
    attributes: dict[str, str] = Field(default_factory=dict)


class ParsedSchemaField(BaseModel):
    id: str
    name: str | None = None
    type: str | None = None
    path: list[str] = Field(default_factory=list)
    required: bool = False
    disabled: bool = False
    read_only: bool = False
    value_type: str | None = None
    conditional_disable: list[SchemaDependencyGroup] = Field(default_factory=list)
    rules: list[SchemaRule] = Field(default_factory=list)
    options: list[SchemaOption] = Field(default_factory=list)
    children: list["ParsedSchemaField"] = Field(default_factory=list)


class SchemaParseResult(BaseModel):
    fields: list[ParsedSchemaField]
    required_field_ids: list[str]
    manual_confirmation_field_ids: list[str]


class SchemaFieldGuidance(BaseModel):
    field: str
    name: str | None = None
    type: str | None = None
    required: bool = False
    manual_fact: bool = False
    responsibility: Literal[
        "ai_candidate",
        "merchant",
        "business_system",
        "store_default",
    ] = "merchant"
    responsibility_label: str = "客户填写"
    responsibility_reason: str = "Alibaba 类目字段，需由客户提供真实值"
    allowed_sources: list[FieldSource] = Field(default_factory=list)
    async_options: bool = False
    async_query_method: str | None = None
    value_type: str | None = None
    max_length: int | None = None
    min_length: int | None = None
    min_value: str | None = None
    max_value: str | None = None
    min_input_num: int | None = None
    max_input_num: int | None = None
    pattern: str | None = None
    value_attributes: list[str] = Field(default_factory=list)
    conditional_disable: list[SchemaDependencyGroup] = Field(default_factory=list)
    supported: bool = True
    support_message: str | None = None
    tip: str | None = None
    options: list[SchemaOption] = Field(default_factory=list)
    parent_path: str | None = None
    repeatable_group: str | None = None


class SchemaGuidanceResult(BaseModel):
    ai_fillable_fields: list[SchemaFieldGuidance]
    manual_fact_fields: list[SchemaFieldGuidance]
    required_field_ids: list[str]


class FieldTask(BaseModel):
    field_path: str
    parent_path: str | None = None
    label: str
    question: str
    explanation: str | None = None
    example: str | None = None
    unit: str | None = None
    control_type: str
    status: Literal["completed", "confirm", "fill", "invalid"]
    responsibility: Literal[
        "ai_candidate",
        "merchant",
        "business_system",
        "store_default",
    ]
    responsibility_label: str
    allowed_sources: list[FieldSource] = Field(default_factory=list)
    value: Any | None = None
    display_value_zh: Any | None = None
    source: FieldSource | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    evidence: str | None = None
    required: bool = False
    blocking: bool = False
    validation_errors: list[str] = Field(default_factory=list)
    options: list[SchemaOption] = Field(default_factory=list)
    async_options: bool = False
    async_query_method: str | None = None
    value_type: str | None = None
    max_length: int | None = None
    min_length: int | None = None
    min_value: str | None = None
    max_value: str | None = None
    min_input_num: int | None = None
    max_input_num: int | None = None
    pattern: str | None = None
    value_attributes: list[str] = Field(default_factory=list)
    supported: bool = True
    support_message: str | None = None
    repeatable_group: str | None = None


class FieldTaskSummary(BaseModel):
    completed: int = 0
    confirm: int = 0
    fill: int = 0
    invalid: int = 0


class FieldTaskRequest(ProductValidationRequest):
    category_id: str | None = None


class AsyncSchemaOptionsRequest(FieldTaskRequest):
    category_id: str
    field_path: str = Field(min_length=1, max_length=500)
    language: Literal["en_US", "zh", "zh_TW"] = "en_US"


class FieldTaskResult(BaseModel):
    tasks: list[FieldTask]
    summary: FieldTaskSummary
    ready_to_draft: bool


class FieldConfirmationRequest(BaseModel):
    batch_id: str = Field(min_length=8, max_length=100)
    reference: str = Field(min_length=1, max_length=200)
    field_path: str = Field(min_length=1, max_length=500)
    value: Any
    display_value_zh: Any | None = None
    original_source: Literal["image_extracted", "ai_generated"]
    confidence: float | None = Field(default=None, ge=0, le=1)
    evidence: str | None = None
    schema_data: dict[str, Any] | str
    action: Literal["accepted", "edited"] = "accepted"


class FieldConfirmationResult(BaseModel):
    field_path: str
    field: DraftField


class DraftFieldDifference(BaseModel):
    field_path: str
    local_value: Any | None = None
    platform_value: Any | None = None
    status: Literal["changed", "matched"]


class DraftSnapshotResult(BaseModel):
    id: str
    batch_id: str
    reference: str
    product_id: str | None = None
    request_fields: dict[str, Any]
    platform_response: dict[str, Any]
    differences: list[DraftFieldDifference]
    created_at: str


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


class ListingTemplateCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category_id: str | None = Field(default=None, max_length=100)
    fields: dict[str, Any] = Field(default_factory=dict)


class ListingTemplateUpdateRequest(ListingTemplateCreateRequest):
    pass


class ListingTemplateResult(BaseModel):
    id: str
    store_connection_id: str
    name: str
    category_id: str | None = None
    fields: dict[str, Any]
    created_at: str
    updated_at: str


class ListingTemplateApplyRequest(BaseModel):
    schema_data: dict[str, Any] | str
    fields: dict[str, DraftField] = Field(default_factory=dict)
    account_defaults: dict[str, DraftField] = Field(default_factory=dict)


class ListingTemplateApplyResult(BaseModel):
    fields: dict[str, DraftField]
    tasks: FieldTaskResult


class ListingImportRow(BaseModel):
    row_number: int
    reference: str
    fields: dict[str, DraftField]
    warnings: list[str] = Field(default_factory=list)


class ListingImportResult(BaseModel):
    format: Literal["csv", "xlsx", "erp_json"]
    rows: list[ListingImportRow]
    errors: list[str] = Field(default_factory=list)


class ListingFeatureFlags(BaseModel):
    workflow_v2: bool = True
    templates: bool = True
    imports: bool = True
    metrics: bool = True
    legacy_fallback: bool = True


class ListingFeatureFlagsUpdate(BaseModel):
    workflow_v2: bool | None = None
    templates: bool | None = None
    imports: bool | None = None
    metrics: bool | None = None
    legacy_fallback: bool | None = None


class ListingMetricEventRequest(BaseModel):
    event_type: Literal[
        "upload_started",
        "analysis_failed",
        "task_evaluated",
        "import_completed",
        "template_applied",
        "field_confirmed",
        "field_edited",
        "draft_succeeded",
        "draft_failed",
        "publish_succeeded",
        "publish_failed",
    ]
    batch_id: str | None = Field(default=None, max_length=100)
    reference: str | None = Field(default=None, max_length=200)
    duration_ms: int | None = Field(default=None, ge=0)
    reason: str | None = Field(default=None, max_length=1000)
    payload: dict[str, Any] = Field(default_factory=dict)


class ListingMetricsResult(BaseModel):
    total_events: int
    counters: dict[str, int]
    failure_reasons: dict[str, int]
    median_draft_duration_ms: int | None = None
    first_pass_draft_rate: float | None = None
    ai_safe_completion_rate: float | None = None
    average_manual_field_count: float | None = None
    ai_confirmation_edit_rate: float | None = None
    publish_failure_rate: float | None = None
    error_localization_rate: float | None = None
