import type { DraftField, SchemaFieldGuidance } from "./types";

type CategoryProfile = {
  version: 1;
  updatedAt: string;
  fields: Record<string, DraftField>;
};

const STORAGE_PREFIX = "auto-shoper-category-profile";

function profileKey(storeId: string, categoryId: string, transactionType: string): string {
  return [STORAGE_PREFIX, storeId || "no-store", categoryId, transactionType]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

function normalizedFieldText(field: SchemaFieldGuidance): string {
  return [field.field, field.name, field.parent_path]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

/**
 * Only remember choices that describe a store's selling convention.
 * Product-specific facts (price, stock, material, size, logistics measurements, etc.)
 * must never leak from one product to another.
 */
export function isSafeCategoryProfileField(field: SchemaFieldGuidance): boolean {
  const text = normalizedFieldText(field);
  const safeTokens = [
    "scprice",
    "pricemode",
    "pricesetting",
    "sellproductby",
    "quantityunit",
    "priceunit",
    "tradeunit",
    "shippingtemplatetemplatetype",
  ];
  return safeTokens.some((token) => text.includes(token));
}

export function loadCategoryProfile(
  storeId: string,
  categoryId: string,
  transactionType: string,
  availableFields: SchemaFieldGuidance[],
): Record<string, DraftField> {
  if (typeof window === "undefined" || !categoryId) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(profileKey(storeId, categoryId, transactionType));
    if (!raw) {
      return {};
    }
    const profile = JSON.parse(raw) as CategoryProfile;
    if (profile.version !== 1 || !profile.fields) {
      return {};
    }
    const allowed = new Set(
      availableFields.filter(isSafeCategoryProfileField).map((field) => field.field),
    );
    return Object.fromEntries(
      Object.entries(profile.fields).filter(([field]) => allowed.has(field)),
    );
  } catch {
    return {};
  }
}

export function saveCategoryProfileField(
  storeId: string,
  categoryId: string,
  transactionType: string,
  field: SchemaFieldGuidance,
  value: unknown,
): void {
  if (typeof window === "undefined" || !categoryId || !isSafeCategoryProfileField(field)) {
    return;
  }
  const key = profileKey(storeId, categoryId, transactionType);
  try {
    const existing = window.localStorage.getItem(key);
    const profile: CategoryProfile = existing
      ? (JSON.parse(existing) as CategoryProfile)
      : { version: 1, updatedAt: new Date().toISOString(), fields: {} };
    const fields = { ...(profile.fields ?? {}) };
    if (value === null || value === undefined || value === "") {
      delete fields[field.field];
    } else {
      fields[field.field] = { value, source: "user_confirmed" };
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), fields }),
    );
  } catch {
    // Category memory is an enhancement; storage failure must never block listing.
  }
}
