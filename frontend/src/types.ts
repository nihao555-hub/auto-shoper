export type AppView = "overview" | "stores" | "workbench" | "batches";

export type DataMode = "live" | "demo";

export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  workspace_id: string;
  workspace_name: string;
};

export type RegisterPayload = {
  email: string;
  password: string;
  display_name: string;
  workspace_name: string;
  registration_code: string;
};

export type FieldSource =
  | "image_extracted"
  | "ai_generated"
  | "user_provided"
  | "user_confirmed"
  | "business_system"
  | "account_default";

export type ProductStage =
  | "uploaded"
  | "analyzing"
  | "ai_ready"
  | "facts_needed"
  | "ready"
  | "drafting"
  | "drafted"
  | "publishing"
  | "published"
  | "error";

export type DraftField = {
  value: unknown;
  display_value_zh?: unknown;
  source: FieldSource;
  confidence?: number;
  requires_confirmation?: boolean;
  evidence?: string;
  confirmation_id?: string;
  confirmed_at?: string;
  confirmed_by?: string;
  user_edited?: boolean;
};

export type ProductFacts = {
  categoryId: string;
  categoryLabel: string;
  categoryLabelZh?: string;
  brand: string;
  model: string;
  material: string;
  price: string;
  moq: string;
  stock: string;
  productLength: string;
  productWidth: string;
  productHeight: string;
  netWeight: string;
  packageLength: string;
  packageWidth: string;
  packageHeight: string;
  grossWeight: string;
  unitsPerCarton: string;
  leadTime: string;
  origin: string;
  hsCode: string;
  certifications: string[];
  skuRows?: ProductSkuRow[];
};

export type ProductSkuRow = {
  id: string;
  sku: string;
  attributes: string;
  price: string;
  stock: string;
};

export type ProductImage = {
  id: string;
  url: string;
  name: string;
  sourceFile?: File;
  photoBankUrl?: string;
  photoBankFileId?: string;
  source?: "upload" | "photobank" | "generated";
};

export type SchemaOption = {
  display_name?: string;
  value: string;
  valid?: boolean;
  attributes?: Record<string, string>;
};

export type SchemaDependencyGroup = {
  operator: "and" | "or";
  expressions: Array<{
    field_id: string;
    value?: string;
    symbol: string;
  }>;
};

export type SchemaFieldGuidance = {
  field: string;
  name?: string;
  type?: string;
  required: boolean;
  manual_fact: boolean;
  responsibility: "ai_candidate" | "merchant" | "business_system" | "store_default";
  responsibility_label: string;
  responsibility_reason: string;
  allowed_sources: FieldSource[];
  async_options?: boolean;
  async_query_method?: string;
  value_type?: string;
  max_length?: number;
  min_length?: number;
  min_value?: string;
  max_value?: string;
  min_input_num?: number;
  max_input_num?: number;
  pattern?: string;
  value_attributes?: string[];
  conditional_disable?: SchemaDependencyGroup[];
  supported?: boolean;
  support_message?: string;
  tip?: string;
  options: SchemaOption[];
  parent_path?: string;
  repeatable_group?: string;
};

export type SchemaGuidanceResult = {
  ai_fillable_fields: SchemaFieldGuidance[];
  manual_fact_fields: SchemaFieldGuidance[];
  required_field_ids: string[];
};

export type FieldTaskStatus = "completed" | "confirm" | "fill" | "invalid";

export type FieldTask = {
  field_path: string;
  parent_path?: string;
  label: string;
  question: string;
  explanation?: string;
  example?: string;
  unit?: string;
  control_type: string;
  status: FieldTaskStatus;
  responsibility: "ai_candidate" | "merchant" | "business_system" | "store_default";
  responsibility_label: string;
  allowed_sources: FieldSource[];
  value: unknown;
  display_value_zh?: unknown;
  source?: FieldSource;
  confidence?: number;
  evidence?: string;
  required: boolean;
  blocking: boolean;
  validation_errors: string[];
  options: SchemaOption[];
  async_options: boolean;
  async_query_method?: string;
  value_type?: string;
  max_length?: number;
  min_length?: number;
  min_value?: string;
  max_value?: string;
  min_input_num?: number;
  max_input_num?: number;
  pattern?: string;
  value_attributes?: string[];
  supported?: boolean;
  support_message?: string;
  repeatable_group?: string;
};

export type FieldTaskSummary = Record<FieldTaskStatus, number>;

export type FieldTaskResult = {
  tasks: FieldTask[];
  summary: FieldTaskSummary;
  ready_to_draft: boolean;
};

export type DraftFieldDifference = {
  field_path: string;
  local_value: unknown;
  platform_value: unknown;
  status: "changed" | "matched";
};

export type ProductTranslation = {
  targetMarketCode: string;
  targetMarketLabel: string;
  targetLanguageCode: string;
  targetLanguageLabel: string;
  title: string;
  keywords: string[];
  sellingPoints: string[];
  description: string;
  confirmed: boolean;
  translatedAt: string;
};

export type ProductRecord = {
  id: string;
  reference: string;
  images: ProductImage[];
  mainImageId: string;
  title: string;
  titleZh?: string;
  keywords: string[];
  keywordsZh?: string[];
  sellingPoints: string[];
  sellingPointsZh?: string[];
  description: string;
  descriptionZh?: string;
  visibleTraits: string[];
  visibleTraitsZh?: string[];
  aiConfirmed: boolean;
  analyzedAt?: string;
  categoryConfidence?: number;
  categoryEvidence?: string;
  stage: ProductStage;
  facts: ProductFacts;
  errors: string[];
  draftProductId?: string;
  draftReadback?: Record<string, unknown>;
  draftDifferences?: DraftFieldDifference[];
  draftReadbackError?: string;
  draftReadbackVerified?: boolean;
  schemaData?: Record<string, unknown> | string;
  schemaGuidance?: SchemaGuidanceResult;
  schemaFields?: Record<string, DraftField>;
  fieldTasks?: FieldTask[];
  fieldTaskSummary?: FieldTaskSummary;
  translation?: ProductTranslation;
  isDemo?: boolean;
};

export type StoreSettings = {
  currency: string;
  priceUnit: string;
  productGroupId: string;
  productGroupLabel: string;
  photoBankGroupId: string;
  photoBankGroupLabel: string;
  warehouseId: string;
  warehouseLabel: string;
  shippingTemplateId: string;
  shippingTemplateLabel: string;
  inventoryCode: string;
  companyProfile: string;
  afterSalesPolicy: string;
  customizationPolicy: string;
  detailTemplate: string;
  brand: string;
  origin: string;
  port: string;
  reuseCompanyProfile: boolean;
  reuseAfterSales: boolean;
  reuseCustomization: boolean;
  reuseDetailTemplate: boolean;
  reuseOrigin: boolean;
};

export type CapabilityResponse = {
  modules: {
    alibaba_listing: boolean;
    ai_images: boolean;
    sales_expert: boolean;
  };
  alibaba_credentials_configured: boolean;
  alibaba_oauth_configured: boolean;
  alibaba_connection_state:
    | "unconfigured"
    | "configuration_error"
    | "not_connected"
    | "connected"
    | "expired";
  alibaba_connection_source: "oauth" | "environment" | null;
  alibaba_oauth_configuration_error: string | null;
  alibaba_oauth_redirect_uri: string | null;
  active_store_id: string | null;
  model_credentials_configured: boolean;
};

export type AlibabaConnectedStore = {
  id: string;
  user_id: string | null;
  login_id: string | null;
  account: string | null;
  expires_at: string | null;
  expired: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
  product_count: number | null;
  product_sync_state: "pending" | "synced" | "failed";
  photobank_group_count: number | null;
  photobank_sync_state: "pending" | "synced" | "failed";
  product_group_count: number | null;
  product_group_sync_state: "pending" | "synced" | "failed" | "not_available";
  permissions: Record<string, "pending" | "verified" | "failed">;
  permission_health: "pending" | "healthy" | "attention" | "expired";
  permission_verified_count: number;
  permission_total_count: number;
  draft_readiness: "ready" | "verification_required" | "blocked";
  ready_to_create_draft: boolean;
  readiness_blockers: string[];
  sync_error: string | null;
  merchant_assets: MerchantAssets;
  template_defaults?: Partial<StoreSettings>;
};

export type MerchantAssets = {
  company_profile: string;
  after_sales_policy: string;
  customization_policy: string;
  detail_template: string;
  origin: string;
  brand: string;
};

export type AlibabaOAuthStatus = {
  oauth_configured: boolean;
  connected: boolean;
  connection_state: CapabilityResponse["alibaba_connection_state"];
  connection_source: "oauth" | "environment" | null;
  user_id: string | null;
  expires_at: string | null;
  configuration_error: string | null;
  redirect_uri: string | null;
  active_store_id: string | null;
  stores: AlibabaConnectedStore[];
};

export type AlibabaStoreDirectory = {
  active_store_id: string | null;
  stores: AlibabaConnectedStore[];
};

export type AlibabaCategoryOption = {
  id: string;
  name: string;
  leaf: boolean;
  level: number | null;
  child_ids: string[];
};

export type AlibabaCategoryLevel = {
  parent: AlibabaCategoryOption | null;
  categories: AlibabaCategoryOption[];
};

export type AlibabaCategoryRecommendation = {
  category_id: string;
  path: AlibabaCategoryOption[];
  confidence: number;
  reason: string;
};

export type AlibabaCategoryRecommendationResult = {
  recommendations: AlibabaCategoryRecommendation[];
  strategy: "ai" | "keyword_fallback";
  warning: string | null;
};

export type ListingFieldGroup = {
  key: string;
  label: string;
  scope: "store" | "product";
  input_mode: "ai_assisted" | "trusted_only";
  fields: Array<{
    name: string;
    label: string;
    reason: string;
    aliases: string[];
  }>;
  allowed_sources: FieldSource[];
  confirmation_rule: string;
};

export type ImageAnalysisResponse = {
  observed_fields: Record<string, DraftField>;
  generated_fields: Record<string, DraftField>;
  category_suggestions: DraftField[];
  manual_requirements: Array<{
    name: string;
    label: string;
    reason: string;
  }>;
  warnings: string[];
};

export type ProductContentTranslationResponse = {
  target_language_code: string;
  target_language: string;
  title: string;
  keywords: string[];
  selling_points: string[];
  description: string;
};

export type ImageSlot = "main" | "detail" | "scenario" | "specification" | "packaging";

export type ImagePromptTemplate = {
  slot: ImageSlot;
  label: string;
  schema_field: string | null;
  required: boolean;
  instruction: string;
};

export type ImageInputRequirement = {
  key: string;
  label: string;
  description: string;
  required: boolean;
};

export type ImageSlotPlan = {
  slot: ImageSlot;
  label: string;
  purpose: string;
  required: boolean;
  can_generate: boolean;
  missing_user_inputs: ImageInputRequirement[];
};

export type ProductImageCandidate = {
  slot: ImageSlot;
  label: string;
  image_url: string | null;
  error: string | null;
  requires_confirmation?: boolean;
  source_image_preservation_required?: boolean;
  can_generate?: boolean;
  missing_user_inputs?: ImageInputRequirement[];
};

export type ProductImageGenerationResponse = {
  product_id: string;
  candidates: ProductImageCandidate[];
};

export type ProductImagePlanResponse = {
  product_id: string;
  target_language: "en_US";
  slots: ImageSlotPlan[];
};

export type BatchApiResult = {
  reference: string;
  success: boolean;
  response?: Record<string, unknown>;
  error?: string;
};

export type ListingTemplate = {
  id: string;
  store_connection_id: string;
  name: string;
  category_id: string | null;
  fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ListingImportResult = {
  format: "csv" | "xlsx" | "erp_json";
  rows: Array<{
    row_number: number;
    reference: string;
    fields: Record<string, DraftField>;
    warnings: string[];
  }>;
  errors: string[];
};

export type ListingFeatureFlags = {
  workflow_v2: boolean;
  templates: boolean;
  imports: boolean;
  metrics: boolean;
  legacy_fallback: boolean;
};

export type ListingMetrics = {
  total_events: number;
  counters: Record<string, number>;
  failure_reasons: Record<string, number>;
  median_draft_duration_ms: number | null;
  first_pass_draft_rate: number | null;
  ai_safe_completion_rate: number | null;
  average_manual_field_count: number | null;
  ai_confirmation_edit_rate: number | null;
  publish_failure_rate: number | null;
  error_localization_rate: number | null;
};

export type ToastMessage = {
  id: number;
  tone: "success" | "warning" | "error" | "info";
  title: string;
  detail?: string;
};

export type BatchRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  productCount: number;
  completion: number;
  draftCount: number;
  publishedCount: number;
  reviewStatus: "none" | "passed" | "failed" | "pending";
  reviewLabel: string;
  status: "processing" | "ready" | "complete" | "failed" | "planned";
  images: string[];
  targetStore?: string;
  targetDomain?: string;
  failureReason?: string;
  failedCount?: number;
  plannedFor?: string;
};
