import type {
  AlibabaOAuthStatus,
  BatchApiResult,
  CapabilityResponse,
  DraftField,
  ImageAnalysisResponse,
  ListingFieldGroup,
  ProductRecord,
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
  parseResponse<CapabilityResponse>(await fetch(`${API_ROOT}/capabilities`));

export const getAlibabaOAuthStatus = async (): Promise<AlibabaOAuthStatus> =>
  parseResponse<AlibabaOAuthStatus>(await fetch(`${API_ROOT}/alibaba/oauth/status`));

export const startAlibabaOAuth = async (): Promise<{ authorization_url: string }> =>
  parseResponse<{ authorization_url: string }>(
    await fetch(`${API_ROOT}/alibaba/oauth/authorize`, { method: "POST" }),
  );

export const getListingFieldMatrix = async (): Promise<ListingFieldGroup[]> =>
  parseResponse<ListingFieldGroup[]>(await fetch(`${API_ROOT}/alibaba/listing-field-matrix`));

export const analyzeProductImage = async (file: File): Promise<ImageAnalysisResponse> => {
  const body = new FormData();
  body.append("image", file);
  body.append("known_facts", "{}");
  return parseResponse<ImageAnalysisResponse>(
    await fetch(`${API_ROOT}/products/analyze-image`, {
      method: "POST",
      body,
    }),
  );
};

export const getCategorySchema = async (categoryId: string): Promise<Record<string, unknown>> =>
  parseResponse<Record<string, unknown>>(
    await fetch(`${API_ROOT}/alibaba/categories/${categoryId}/schema?language=en_US`),
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
  products: ProductRecord[],
  settings: StoreSettings,
): Promise<BatchApiResult[]> =>
  parseResponse<BatchApiResult[]>(
    await fetch(`${API_ROOT}/products/official-listing/batch/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
  products: ProductRecord[],
  settings: StoreSettings,
): Promise<BatchApiResult[]> =>
  parseResponse<BatchApiResult[]>(
    await fetch(`${API_ROOT}/products/official-listing/batch/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
