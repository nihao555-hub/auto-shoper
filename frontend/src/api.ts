import type {
  AlibabaConnectedStore,
  AlibabaOAuthStatus,
  AlibabaStoreDirectory,
  AuthUser,
  BatchApiResult,
  CapabilityResponse,
  DraftField,
  ImageAnalysisResponse,
  ImagePromptTemplate,
  ImageSlot,
  ListingFieldGroup,
  ProductImageGenerationResponse,
  ProductImagePlanResponse,
  ProductRecord,
  RegisterPayload,
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

export type PhotoBankImage = {
  id: string;
  name: string;
  url: string;
};

export const listPhotoBankGroups = async (): Promise<Record<string, unknown>> =>
  parseResponse<Record<string, unknown>>(
    await apiFetch(`${API_ROOT}/alibaba/photo-bank/groups?current_page=1&page_size=50`),
  );

export const listPhotoBankImages = async (
  groupId: string,
  page = 1,
): Promise<Record<string, unknown>> =>
  parseResponse<Record<string, unknown>>(
    await apiFetch(
      `${API_ROOT}/alibaba/photo-bank/images?group_id=${encodeURIComponent(groupId)}&current_page=${page}&page_size=40`,
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
  }));

export const findPhotoBankUrl = (payload: Record<string, unknown>): string | null => {
  const preferredKeys = ["url", "image_url", "imageUrl", "image_uri", "imageUri"];
  for (const key of preferredKeys) {
    const value = payload[key];
    if (typeof value === "string" && value.startsWith("http")) {
      return value;
    }
  }
  for (const value of Object.values(payload)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = findPhotoBankUrl(value as Record<string, unknown>);
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

const trustedField = (value: unknown): DraftField => ({
  value,
  source: "user_provided",
});

const confirmedField = (value: unknown): DraftField => ({
  value,
  source: "user_confirmed",
});

const accountDefault = (value: unknown): DraftField => ({
  value,
  source: "account_default",
});

const productFields = (product: ProductRecord): Record<string, DraftField> => ({
  category_id: confirmedField(product.facts.categoryId),
  subject: confirmedField(product.title),
  keywords: confirmedField(product.keywords),
  description: confirmedField(product.description),
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
  images: confirmedField(product.images.flatMap((image) => image.photoBankUrl ?? [])),
  main_image: confirmedField(
    product.images.find((image) => image.id === product.mainImageId)?.photoBankUrl ?? "",
  ),
});

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

export const findSchemaData = (
  payload: Record<string, unknown>,
): Record<string, unknown> | string | null => {
  const preferredKeys = ["schema", "schema_data", "schemaData", "xml", "result"];
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
