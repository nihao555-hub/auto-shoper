import type { SchemaOption } from "./types";

const normalizeSchemaOptionText = (value: string): string =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function schemaOptionMatches(option: SchemaOption, requestedValue: string): boolean {
  const normalizedRequested = normalizeSchemaOptionText(requestedValue);
  if (!normalizedRequested) {
    return false;
  }
  if (normalizeSchemaOptionText(option.value) === normalizedRequested) {
    return true;
  }
  const displayName = option.display_name ?? "";
  if (normalizeSchemaOptionText(displayName) === normalizedRequested) {
    return true;
  }
  return displayName
    .split(/[\/／|,，()（）]+/)
    .some((alias) => normalizeSchemaOptionText(alias) === normalizedRequested);
}

export function resolveSchemaOptionValue(
  options: SchemaOption[],
  requestedValue: string,
): string | null {
  if (!normalizeSchemaOptionText(requestedValue)) {
    return null;
  }
  return options.find((option) => schemaOptionMatches(option, requestedValue))?.value ?? null;
}
