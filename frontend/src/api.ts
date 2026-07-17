import type {
  AlibabaCategoryLevel,
  AlibabaCategoryRecommendationResult,
  AlibabaConnectedStore,
  AlibabaOAuthStatus,
  AlibabaProductTypeCapabilities,
  AlibabaStoreDirectory,
  AlibabaVideo,
  AuthUser,
  BatchApiResult,
  CapabilityResponse,
  DraftField,
  FieldTaskResult,
  ImageAnalysisResponse,
  ImagePromptTemplate,
  ImageSlot,
  ListingFeatureFlags,
  ListingFieldGroup,
  ListingImportResult,
  ListingMetrics,
  ListingTemplate,
  ProductContentTranslationResponse,
  ProductImageGenerationResponse,
  ProductImagePlanResponse,
  ProductRecord,
  PublishJobStatus,
  RegisterPayload,
  SchemaGuidanceResult,
  StoreSettings,
} from "./types";

const configuredApiRoot = import.meta.env.VITE_API_ROOT ?? "/api/v1";
const API_ROOT = configuredApiRoot.startsWith("http")
  ? configuredApiRoot
  : new URL(configuredApiRoot, window.location.origin).toString().replace(/\/$/, "");

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const apiFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, { ...init, credentials: "include" });

const parseResponse = async <T>(response: Response): Promise<T> => {
  if (response.ok) {
    return (await response.json()) as T;
  }
  let detail = `请求失败 (${response.status})`;
  try {
    const payload = (await response.json()) as { detail?: string | { message?: string } };
    if (typeof payload.detail === "string") {
      detail = payload.detail;
    } else if (payload.detail?.message) {
      detail = payload.detail.message;
    }
  } catch {
    detail = response.statusText || detail;
  }
  throw new ApiError(detail, response.status);
};

export const getCapabilities = async (): Promise<CapabilityResponse> =>
  parseResponse<CapabilityResponse>(await apiFetch(`${API_ROOT}/capabilities`));

export const getCurrentUser = async (): Promise<AuthUser> =>
  parseResponse<AuthUser>(await apiFetch(`${API_ROOT}/auth/me`));

export const login = async (email: string, password: string): Promise<AuthUser> =>
  parseResponse<AuthUser>(
    await apiFetch(`${API_ROOT}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );

export const register = async (payload: RegisterPayload): Promise<AuthUser> =>
  parseResponse<AuthUser>(
    await apiFetch(`${API_ROOT}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );

export const logout = async (): Promise<void> => {
  const response = await apiFetch(`${API_ROOT}/auth/logout`, { method: "POST" });
  if (!response.ok && response.status !== 204) {
    await parseResponse(response);
  }
};

export const getAlibabaOAuthStatus = async (): Promise<AlibabaOAuthStatus> =>
  parseResponse<AlibabaOAuthStatus>(await apiFetch(`${API_ROOT}/alibaba/oauth/status`));

export const getAlibabaStores = async (): Promise<AlibabaStoreDirectory> =>
  parseResponse<AlibabaStoreDirectory>(await apiFetch(`${API_ROOT}/alibaba/stores`));

export const activateAlibabaStore = async (storeId: string): Promise<AlibabaConnectedStore> =>
  parseResponse<AlibabaConnectedStore>(
    await apiFetch(`${API_ROOT}/alibaba/stores/${storeId}/activate`, { method: "POST" }),
  );

export const syncAlibabaStore = async (storeId: string): Promise<AlibabaConnectedStore> =>
  parseResponse<AlibabaConnectedStore>(
    await apiFetch(`${API_ROOT}/alibaba/stores/${storeId}/sync`, { method: "POST" }),
  );

export const disconnectAlibabaStore = async (storeId: string): Promise<void> => {
  const response = await apiFetch(`${API_ROOT}/alibaba/stores/${encodeURIComponent(storeId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    await parseResponse(response);
  }
};

export const startAlibabaOAuth = async (): Promise<{ authorization_url: string }> =>
  parseResponse<{ authorization_url: string }>(
    await apiFetch(`${API_ROOT}/alibaba/oauth/authorize`, { method: "POST" }),
  );

export const getListingFieldMatrix = async (): Promise<ListingFieldGroup[]> =>
  parseResponse<ListingFieldGroup[]>(await apiFetch(`${API_ROOT}/alibaba/listing-field-matrix`));

export const getListingFeatureFlags = async (): Promise<ListingFeatureFlags> =>
  parseResponse<ListingFeatureFlags>(
    await apiFetch(`${API_ROOT}/products/official-listing/feature-flags`),
  );

export const updateListingFeatureFlags = async (
  updates: Partial<ListingFeatureFlags>,
): Promise<ListingFeatureFlags> =>
  parseResponse<ListingFeatureFlags>(
    await apiFetch(`${API_ROOT}/products/official-listing/feature-flags`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }),
  );

export const getListingMetrics = async (): Promise<ListingMetrics> =>
  parseResponse<ListingMetrics>(await apiFetch(`${API_ROOT}/products/official-listing/metrics`));

export const importListingProducts = async (file: File): Promise<ListingImportResult> => {
  const body = new FormData();
  body.append("file", file);
  return parseResponse<ListingImportResult>(
    await apiFetch(`${API_ROOT}/products/official-listing/import`, { method: "POST", body }),
  );
};

export const recordListingMetricEvent = async (event: {
  event_type: "upload_started" | "task_evaluated" | "analysis_failed" | "field_confirmed";
  batch_id?: string;
  reference?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}): Promise<void> => {
  const response = await apiFetch(`${API_ROOT}/products/official-listing/metrics/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    await parseResponse(response);
  }
};

export const analyzeProductImages = async (
  files: File[],
  schemaData?: Record<string, unknown> | string,
): Promise<ImageAnalysisResponse> => {
  const body = new FormData();
  for (const file of files) {
    body.append("images", file);
  }
  body.append("known_facts", "{}");
  if (schemaData) {
    body.append(
      "schema_data",
      typeof schemaData === "string" ? schemaData : JSON.stringify(schemaData),
    );
  }
  return parseResponse<ImageAnalysisResponse>(
    await apiFetch(`${API_ROOT}/products/analyze-image`, {
      method: "POST",
      body,
    }),
  );
};

export const translateProductContent = async (
  product: ProductRecord,
  targetLanguageCode: string,
  targetLanguage: string,
): Promise<ProductContentTranslationResponse> =>
  parseResponse<ProductContentTranslationResponse>(
    await apiFetch(`${API_ROOT}/products/translate-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_language: "English",
        target_language_code: targetLanguageCode,
        target_language: targetLanguage,
        title: product.title,
        keywords: product.keywords,
        selling_points: product.sellingPoints,
        description: product.description,
      }),
    }),
  );

export const getImagePromptTemplates = async (): Promise<ImagePromptTemplate[]> =>
  parseResponse<ImagePromptTemplate[]>(await apiFetch(`${API_ROOT}/images/prompt-templates`));

type ProductImageOptions = {
  slots?: ImageSlot[];
  existingSlots?: ImageSlot[];
  userInputs?: Record<string, string>;
  extraPrompt?: string;
};

const buildImageRequestPayload = (product: ProductRecord, options?: ProductImageOptions) => ({
  product_id: product.id,
  title: product.title,
  category: product.facts.categoryLabel,
  description: product.description,
  keywords: product.keywords,
  visible_traits: product.visibleTraits,
  slots: options?.slots ?? [],
  existing_slots: options?.existingSlots ?? [],
  target_language: "en_US",
  user_inputs: options?.userInputs ?? {},
  extra_prompt: options?.extraPrompt ?? "",
  facts: {
    brand: product.facts.brand,
    model: product.facts.model,
    material: product.facts.material,
    price: product.facts.price,
    moq: product.facts.moq,
    stock: product.facts.stock,
    product_length: product.facts.productLength,
    product_width: product.facts.productWidth,
    product_height: product.facts.productHeight,
    net_weight: product.facts.netWeight,
    package_length: product.facts.packageLength,
    package_width: product.facts.packageWidth,
    package_height: product.facts.packageHeight,
    gross_weight: product.facts.grossWeight,
    units_per_carton: product.facts.unitsPerCarton,
    lead_time: product.facts.leadTime,
    origin: product.facts.origin,
    hs_code: product.facts.hsCode,
    certifications: product.facts.certifications,
  },
});

export const planProductImages = async (
  product: ProductRecord,
  options?: ProductImageOptions,
): Promise<ProductImagePlanResponse> =>
  parseResponse<ProductImagePlanResponse>(
    await apiFetch(`${API_ROOT}/products/${encodeURIComponent(product.id)}/image-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildImageRequestPayload(product, options)),
    }),
  );

export const generateProductImages = async (
  product: ProductRecord,
  references: File[],
  options?: ProductImageOptions,
): Promise<ProductImageGenerationResponse> => {
  const body = new FormData();
  for (const reference of references) {
    body.append("references", reference);
  }
  body.append("request", JSON.stringify(buildImageRequestPayload(product, options)));
  return parseResponse<ProductImageGenerationResponse>(
    await apiFetch(`${API_ROOT}/products/${encodeURIComponent(product.id)}/generate-images`, {
      method: "POST",
      body,
    }),
  );
};

export const uploadPhotoBankImage = async (
  file: File,
  groupId: string,
): Promise<Record<string, unknown>> => {
  const body = new FormData();
  body.append("image", file);
  body.append("group_id", groupId);
  return parseResponse<Record<string, unknown>>(
    await apiFetch(`${API_ROOT}/alibaba/photo-bank/images`, {
      method: "POST",
      body,
    }),
  );
};

export type PhotoBankGroup = {
  id: string;
  name: string;
};

export type StoreLinkedOption = {
  id: string;
  name: string;
};

export type PhotoBankImage = {
  id: string;
  name: string;
  url: string;
  fileSize?: number;
};

export const listPhotoBankGroups = async (): Promise<Record<string, unknown>> =>
  parseResponse<Record<string, unknown>>(
    await apiFetch(`${API_ROOT}/alibaba/photo-bank/groups?current_page=1&page_size=50`),
  );

export const listProductGroups = async (): Promise<Record<string, unknown>> =>
  parseResponse<Record<string, unknown>>(await apiFetch(`${API_ROOT}/alibaba/product-groups`));

export const listPhotoBankImages = async (
  groupId: string,
  page = 1,
): Promise<Record<string, unknown>> =>
  parseResponse<Record<string, unknown>>(
    await apiFetch(
      `${API_ROOT}/alibaba/photo-bank/images?group_id=${encodeURIComponent(groupId)}&current_page=${page}&page_size=40`,
    ),
  );

export const listAlibabaVideos = async (
  page = 1,
  pageSize = 20,
  title = "",
): Promise<Record<string, unknown>> => {
  const params = new URLSearchParams({
    current_page: String(page),
    page_size: String(pageSize),
  });
  if (title.trim()) {
    params.set("title", title.trim());
  }
  return parseResponse<Record<string, unknown>>(
    await apiFetch(`${API_ROOT}/alibaba/videos?${params.toString()}`),
  );
};

export const uploadAlibabaVideoByUrl = async (payload: {
  videoPath: string;
  videoName: string;
  coverUrl?: string;
}): Promise<Record<string, unknown>> =>
  parseResponse<Record<string, unknown>>(
    await apiFetch(`${API_ROOT}/alibaba/videos/upload-by-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_path: payload.videoPath,
        video_name: payload.videoName,
        cover_url: payload.coverUrl || undefined,
      }),
    }),
  );

export const uploadAlibabaVideoFile = async (
  file: File,
  placement: "main" | "detail",
): Promise<Record<string, unknown>> => {
  const body = new FormData();
  body.append("video", file);
  body.append("placement", placement);
  body.append("video_name", file.name.replace(/\.[^.]+$/, ""));
  return parseResponse<Record<string, unknown>>(
    await apiFetch(`${API_ROOT}/alibaba/videos/upload-file`, {
      method: "POST",
      body,
    }),
  );
};

export const relateAlibabaVideo = async (
  videoId: string,
  productId: string,
  placement: "main" | "detail",
): Promise<Record<string, unknown>> =>
  parseResponse<Record<string, unknown>>(
    await apiFetch(
      `${API_ROOT}/alibaba/videos/${encodeURIComponent(videoId)}/relations/${placement}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId }),
      },
    ),
  );

const readString = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return "";
};

const readNumber = (record: Record<string, unknown>, keys: string[]): number | undefined => {
  const value = readString(record, keys);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const collectRecords = (
  payload: unknown,
  matches: (record: Record<string, unknown>) => boolean,
) => {
  const found: Record<string, unknown>[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (matches(record)) {
        found.push(record);
        return;
      }
      for (const nested of Object.values(record)) {
        walk(nested);
      }
    }
  };
  walk(payload);
  return found;
};

export const findPhotoBankGroups = (payload: Record<string, unknown>): PhotoBankGroup[] =>
  collectRecords(
    payload,
    (record) =>
      Boolean(readString(record, ["id", "group_id", "groupId"])) &&
      Boolean(readString(record, ["name", "group_name", "groupName"])),
  ).map((record) => ({
    id: readString(record, ["id", "group_id", "groupId"]),
    name: readString(record, ["name", "group_name", "groupName"]),
  }));

export const findProductGroups = (payload: Record<string, unknown>): StoreLinkedOption[] =>
  collectRecords(
    payload,
    (record) =>
      Boolean(readString(record, ["group_id", "groupId"])) &&
      Boolean(readString(record, ["group_name", "groupName"])),
  ).map((record) => ({
    id: readString(record, ["group_id", "groupId"]),
    name: readString(record, ["group_name", "groupName"]),
  }));

export const findPhotoBankImages = (payload: Record<string, unknown>): PhotoBankImage[] =>
  collectRecords(payload, (record) =>
    ["url", "image_url", "imageUrl", "image_uri", "imageUri"].some((key) => {
      const value = record[key];
      return typeof value === "string" && value.startsWith("http");
    }),
  ).map((record, index) => ({
    id: readString(record, ["id", "image_id", "imageId"]) || `photo-${index}`,
    name: readString(record, ["name", "file_name", "fileName", "image_name", "imageName"]),
    url: readString(record, ["url", "image_url", "imageUrl", "image_uri", "imageUri"]),
    fileSize: readNumber(record, ["file_size", "fileSize", "size"]),
  }));

export const findAlibabaVideos = (payload: Record<string, unknown>): AlibabaVideo[] => {
  const videos = collectRecords(payload, (record) =>
    Boolean(readString(record, ["video_id", "videoId"])),
  ).map((record) => {
    const durationValue = readString(record, ["duration"]);
    const duration = durationValue ? Number(durationValue) : undefined;
    return {
      id: readString(record, ["video_id", "videoId"]),
      title: readString(record, ["title", "video_name", "videoName"]) || "未命名视频",
      coverUrl: readString(record, ["cover_url", "coverUrl"]),
      videoUrl: readString(record, ["video_url", "videoUrl"]),
      status: readString(record, ["status", "video_status", "videoStatus"]),
      duration: duration !== undefined && Number.isFinite(duration) ? duration : undefined,
    };
  });
  return [...new Map(videos.map((video) => [video.id, video])).values()];
};

const normalizePhotoBankUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  if (value.startsWith("//")) {
    return `https:${value}`;
  }
  return value.startsWith("http://") || value.startsWith("https://") ? value : null;
};

export const findPhotoBankUrl = (payload: Record<string, unknown>): string | null => {
  const preferredKeys = [
    "photobank_url",
    "photoBankUrl",
    "url",
    "image_url",
    "imageUrl",
    "image_uri",
    "imageUri",
  ];
  for (const key of preferredKeys) {
    const url = normalizePhotoBankUrl(payload[key]);
    if (url) {
      return url;
    }
  }
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          const nested = findPhotoBankUrl(item as Record<string, unknown>);
          if (nested) {
            return nested;
          }
        }
      }
    } else if (value && typeof value === "object") {
      const nested = findPhotoBankUrl(value as Record<string, unknown>);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
};

export const findPhotoBankFileId = (payload: Record<string, unknown>): string | null => {
  const direct = readString(payload, ["file_id", "fileId", "image_id", "imageId", "id"]);
  if (direct) {
    return direct;
  }
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          const nested = findPhotoBankFileId(item as Record<string, unknown>);
          if (nested) {
            return nested;
          }
        }
      }
    } else if (value && typeof value === "object") {
      const nested = findPhotoBankFileId(value as Record<string, unknown>);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
};

export const getCategorySchema = async (categoryId: string): Promise<Record<string, unknown>> =>
  parseResponse<Record<string, unknown>>(
    await apiFetch(`${API_ROOT}/alibaba/categories/${categoryId}/schema?language=en_US`),
  );

export const getCategoryPublishCapabilities = async (
  categoryId: string,
): Promise<AlibabaProductTypeCapabilities> =>
  parseResponse<AlibabaProductTypeCapabilities>(
    await apiFetch(
      `${API_ROOT}/alibaba/categories/${encodeURIComponent(categoryId)}/publish-capabilities?language=zh_cn`,
    ),
  );

export const listCategoryChildren = async (categoryId: string): Promise<AlibabaCategoryLevel> =>
  parseResponse<AlibabaCategoryLevel>(
    await apiFetch(`${API_ROOT}/alibaba/categories/${encodeURIComponent(categoryId)}/children`),
  );

export const recommendAlibabaCategories = async (product: {
  title: string;
  keywords: string[];
  categoryHint: string;
  visibleTraits: string[];
}): Promise<AlibabaCategoryRecommendationResult> =>
  parseResponse<AlibabaCategoryRecommendationResult>(
    await apiFetch(`${API_ROOT}/alibaba/categories/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: product.title,
        keywords: product.keywords,
        category_hint: product.categoryHint,
        visible_traits: product.visibleTraits,
      }),
    }),
  );

export const getSchemaGuidance = async (
  schemaData: Record<string, unknown> | string,
): Promise<SchemaGuidanceResult> =>
  parseResponse<SchemaGuidanceResult>(
    await apiFetch(`${API_ROOT}/alibaba/schemas/guidance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema_data: schemaData }),
    }),
  );

const trustedField = (value: unknown): DraftField => ({
  value,
  source: "user_provided",
});

const candidateOrConfirmedField = (
  product: ProductRecord,
  fieldNames: string[],
  value: unknown,
): DraftField => {
  for (const fieldName of fieldNames) {
    const field = product.schemaFields?.[fieldName];
    if (field) {
      return { ...field, value };
    }
  }
  return {
    value,
    source: product.aiConfirmed ? "user_confirmed" : "ai_generated",
    requires_confirmation: !product.aiConfirmed,
  };
};

const accountDefault = (value: unknown): DraftField => ({
  value,
  source: "account_default",
});

const confirmedField = (value: unknown): DraftField => ({
  value,
  source: "user_confirmed",
});

const normalizedSchemaFields = (fields: Record<string, DraftField>): Record<string, DraftField> => {
  const canonicalAliases: Record<string, string[]> = {
    subject: ["title", "english_title", "product_title"],
    keywords: ["keyword"],
    description: ["detail", "product_description"],
    selling_points: ["sellingPoints", "highlights"],
  };
  const ignored = new Set<string>();
  for (const [canonical, aliases] of Object.entries(canonicalAliases)) {
    if (fields[canonical]) {
      for (const alias of aliases) {
        ignored.add(alias);
      }
    }
  }
  return Object.fromEntries(Object.entries(fields).filter(([field]) => !ignored.has(field)));
};

const listingContent = (product: ProductRecord) =>
  product.translation?.confirmed
    ? {
        title: product.translation.title,
        keywords: product.translation.keywords,
        sellingPoints: product.translation.sellingPoints,
        description: product.translation.description,
      }
    : {
        title: product.title,
        keywords: product.keywords,
        sellingPoints: product.sellingPoints,
        description: product.description,
      };

const localizedDetailImageValue = (value: unknown, text: string): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => localizedDetailImageValue(item, text));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        key === "generalText" ? text : localizedDetailImageValue(item, text),
      ]),
    );
  }
  return value;
};

const localizedSchemaFields = (product: ProductRecord): Record<string, DraftField> => {
  const fields = { ...(product.schemaFields ?? {}) };
  if (!product.translation?.confirmed) {
    return fields;
  }
  const content = listingContent(product);
  fields.productTitle = confirmedField(content.title);
  fields["productKeywords.productKeywords_0"] = confirmedField(content.keywords.join(", "));
  fields.textDesc = confirmedField(
    content.sellingPoints.length ? content.sellingPoints.join("\n") : content.description,
  );
  if (fields.detailImage) {
    fields.detailImage = confirmedField(
      localizedDetailImageValue(fields.detailImage.value, content.description),
    );
  }
  return fields;
};

const productFields = (product: ProductRecord): Record<string, DraftField> => {
  const content = listingContent(product);
  const contentField = (fieldNames: string[], value: unknown) =>
    product.translation?.confirmed
      ? confirmedField(value)
      : candidateOrConfirmedField(product, fieldNames, value);
  return {
    ...normalizedSchemaFields(localizedSchemaFields(product)),
    category_id: candidateOrConfirmedField(
      product,
      ["category_id", "cat_id"],
      product.facts.categoryId,
    ),
    subject: contentField(["subject", "title"], content.title),
    keywords: contentField(["keywords", "keyword"], content.keywords),
    selling_points: contentField(["selling_points", "sellingPoints"], content.sellingPoints),
    description: contentField(["description", "detail"], content.description),
    brand: trustedField(product.facts.brand),
    model: trustedField(product.facts.model),
    material: trustedField(product.facts.material),
    price: trustedField(product.facts.price),
    moq: trustedField(product.facts.moq),
    inventory: trustedField(product.facts.stock),
    dimensions: trustedField({
      length: product.facts.productLength,
      width: product.facts.productWidth,
      height: product.facts.productHeight,
    }),
    weight: trustedField(product.facts.netWeight),
    packaging: trustedField({
      length: product.facts.packageLength,
      width: product.facts.packageWidth,
      height: product.facts.packageHeight,
      grossWeight: product.facts.grossWeight,
      unitsPerCarton: product.facts.unitsPerCarton,
    }),
    lead_time: trustedField(product.facts.leadTime),
    origin: trustedField(product.facts.origin),
    hs_code: trustedField(product.facts.hsCode),
    certifications: trustedField(product.facts.certifications),
    transaction_type: trustedField(product.transactionType ?? ""),
    compliance_evidence: trustedField(product.complianceEvidence ?? {}),
    sku_rows: trustedField(product.facts.skuRows ?? []),
    images: candidateOrConfirmedField(
      product,
      ["images", "scImages"],
      product.images.flatMap((image) => image.photoBankUrl ?? []),
    ),
    main_image: candidateOrConfirmedField(
      product,
      ["main_image", "mainImage"],
      product.images.find((image) => image.id === product.mainImageId)?.photoBankUrl ?? "",
    ),
  };
};

const accountDefaults = (settings: StoreSettings): Record<string, DraftField> => ({
  currency: accountDefault(settings.currency),
  priceUnit: accountDefault(settings.priceUnit),
  productGroupId: accountDefault(settings.productGroupId),
  photobankGroupId: accountDefault(settings.photoBankGroupId),
  warehouseId: accountDefault(settings.warehouseId),
  shippingTemplateId: accountDefault(settings.shippingTemplateId),
  inventoryCode: accountDefault(settings.inventoryCode),
  companyProfile: accountDefault(settings.companyProfile),
  afterSalesPolicy: accountDefault(settings.afterSalesPolicy),
  customizationPolicy: accountDefault(settings.customizationPolicy),
  detailTemplate: accountDefault(settings.detailTemplate),
});

export const getListingTasks = async (
  product: ProductRecord,
  settings: StoreSettings,
): Promise<FieldTaskResult> => {
  if (!product.schemaData) {
    return {
      tasks: [],
      summary: { completed: 0, confirm: 0, fill: 0, invalid: 0 },
      ready_to_draft: false,
    };
  }
  return parseResponse<FieldTaskResult>(
    await apiFetch(`${API_ROOT}/products/official-listing/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category_id: product.facts.categoryId,
        schema_data: product.schemaData,
        fields: productFields(product),
        account_defaults: accountDefaults(settings),
      }),
    }),
  );
};

export const listListingTemplates = async (categoryId?: string): Promise<ListingTemplate[]> => {
  const query = categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : "";
  return parseResponse<ListingTemplate[]>(
    await apiFetch(`${API_ROOT}/products/official-listing/templates${query}`),
  );
};

export const createListingTemplate = async (
  name: string,
  product: ProductRecord,
): Promise<ListingTemplate> =>
  parseResponse<ListingTemplate>(
    await apiFetch(`${API_ROOT}/products/official-listing/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        category_id: product.facts.categoryId || null,
        fields: Object.fromEntries(
          Object.entries(productFields(product))
            .filter(
              ([, field]) => field.source === "user_provided" || field.source === "business_system",
            )
            .map(([fieldPath, field]) => [fieldPath, field.value]),
        ),
      }),
    }),
  );

export const applyListingTemplate = async (
  templateId: string,
  product: ProductRecord,
  settings: StoreSettings,
): Promise<{ fields: Record<string, DraftField>; tasks: FieldTaskResult }> => {
  if (!product.schemaData) {
    throw new Error("请先加载商品类目的实时 Schema，再应用模板");
  }
  return parseResponse<{ fields: Record<string, DraftField>; tasks: FieldTaskResult }>(
    await apiFetch(
      `${API_ROOT}/products/official-listing/templates/${encodeURIComponent(templateId)}/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema_data: product.schemaData,
          fields: productFields(product),
          account_defaults: accountDefaults(settings),
        }),
      },
    ),
  );
};

export const deleteListingTemplate = async (templateId: string): Promise<void> => {
  const response = await apiFetch(
    `${API_ROOT}/products/official-listing/templates/${encodeURIComponent(templateId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    await parseResponse(response);
  }
};

export const getAsyncFieldOptions = async (
  product: ProductRecord,
  settings: StoreSettings,
  fieldPath: string,
): Promise<SchemaGuidanceResult> => {
  if (!product.schemaData || !product.facts.categoryId) {
    throw new Error("缺少实时 Schema 或最终叶子类目，无法加载联动选项");
  }
  return parseResponse<SchemaGuidanceResult>(
    await apiFetch(`${API_ROOT}/products/official-listing/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category_id: product.facts.categoryId,
        field_path: fieldPath,
        language: "en_US",
        schema_data: product.schemaData,
        fields: productFields(product),
        account_defaults: accountDefaults(settings),
      }),
    }),
  );
};

export const confirmListingField = async (
  batchId: string,
  product: ProductRecord,
  fieldPath: string,
  value: unknown,
  action: "accepted" | "edited" = "accepted",
): Promise<{ field_path: string; field: DraftField }> => {
  const candidate = product.schemaFields?.[fieldPath];
  if (!candidate || !product.schemaData) {
    throw new Error("字段缺少 AI 候选或实时 Schema，无法确认");
  }
  if (candidate.source !== "ai_generated" && candidate.source !== "image_extracted") {
    throw new Error("只有 AI 或图片识别候选可以通过此入口确认");
  }
  return parseResponse<{ field_path: string; field: DraftField }>(
    await apiFetch(`${API_ROOT}/products/official-listing/fields/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch_id: batchId,
        reference: product.reference,
        field_path: fieldPath,
        value,
        display_value_zh: candidate.display_value_zh,
        original_source: candidate.source,
        confidence: candidate.confidence,
        evidence: candidate.evidence,
        schema_data: product.schemaData,
        action,
      }),
    }),
  );
};

export const createDraftBatch = async (
  batchId: string,
  products: ProductRecord[],
  settings: StoreSettings,
): Promise<BatchApiResult[]> =>
  parseResponse<BatchApiResult[]>(
    await apiFetch(`${API_ROOT}/products/official-listing/batch/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_id: batchId,
        items: products.map((product) => ({
          reference: product.reference,
          category_id: product.facts.categoryId,
          language: "en_US",
          schema_data: product.schemaData,
          fields: productFields(product),
          account_defaults: accountDefaults(settings),
        })),
        concurrency: 3,
      }),
    }),
  );

export const publishBatch = async (
  batchId: string,
  products: ProductRecord[],
  settings: StoreSettings,
): Promise<BatchApiResult[]> =>
  parseResponse<BatchApiResult[]>(
    await apiFetch(`${API_ROOT}/products/official-listing/batch/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_id: batchId,
        items: products.map((product) => ({
          reference: product.reference,
          draft_product_id: product.draftProductId,
          category_id: product.facts.categoryId,
          language: "en_US",
          schema_data: product.schemaData,
          fields: productFields(product),
          account_defaults: accountDefaults(settings),
        })),
        concurrency: 3,
        confirmed_by_user: true,
      }),
    }),
  );

export const getBatchPublishStatus = async (
  batchId: string,
  refresh = true,
): Promise<PublishJobStatus[]> =>
  parseResponse<PublishJobStatus[]>(
    await apiFetch(
      `${API_ROOT}/products/official-listing/batches/${encodeURIComponent(batchId)}/publish-status?refresh=${refresh}`,
    ),
  );

export const getServerWorkbenchSnapshot = async (): Promise<{
  version: 1;
  batch_id: string;
  products: ProductRecord[];
  updated_at: string;
} | null> =>
  parseResponse(
    await apiFetch(`${API_ROOT}/products/official-listing/workbench-snapshot`),
  );

export const saveServerWorkbenchSnapshot = async (snapshot: {
  version: 1;
  batchId: string;
  products: ProductRecord[];
  updatedAt: string;
}): Promise<void> => {
  await parseResponse(
    await apiFetch(`${API_ROOT}/products/official-listing/workbench-snapshot`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: snapshot.version,
        batch_id: snapshot.batchId,
        products: snapshot.products,
        updated_at: snapshot.updatedAt,
      }),
    }),
  );
};

export const findSchemaData = (
  payload: Record<string, unknown>,
): Record<string, unknown> | string | null => {
  const preferredKeys = ["schema", "schema_data", "schemaData", "xml", "data", "result"];
  for (const key of preferredKeys) {
    const value = payload[key];
    if (typeof value === "string" && value.includes("<")) {
      return value;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = findSchemaData(value as Record<string, unknown>);
      if (nested) {
        return nested;
      }
    }
  }
  for (const value of Object.values(payload)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = findSchemaData(value as Record<string, unknown>);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
};
