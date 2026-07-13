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
};

export type SchemaFieldGuidance = {
  field: string;
  name?: string;
  type?: string;
  required: boolean;
  manual_fact: boolean;
  max_length?: number;
  tip?: string;
  options: SchemaOption[];
};

export type SchemaGuidanceResult = {
  ai_fillable_fields: SchemaFieldGuidance[];
  manual_fact_fields: SchemaFieldGuidance[];
  required_field_ids: string[];
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
  schemaData?: Record<string, unknown> | string;
  schemaGuidance?: SchemaGuidanceResult;
  schemaFields?: Record<string, DraftField>;
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
