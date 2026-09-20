export type SupplierContractType = "supply" | "purchase" | "service" | "framework" | "other";

export type SupplierContractExternalSource = "manual" | "1c" | "import" | "api";

export type SupplierContractMeta = Record<string, unknown>;

export type SupplierContractRow = {
  contractId: string;
  supplierCode: string;
  code: string;
  number: string | null;
  name: string;
  contractType: SupplierContractType;
  validFrom: string | null;
  validTo: string | null;
  currency: string | null;
  isDefault: boolean;
  isActive: boolean;
  externalSource: SupplierContractExternalSource;
  externalId: string | null;
  externalRef: SupplierContractMeta;
  meta: SupplierContractMeta;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export const SUPPLIER_CONTRACT_TYPES: Array<{ value: SupplierContractType; label: string }> = [
  { value: "supply", label: "Поставка" },
  { value: "purchase", label: "Закупка" },
  { value: "service", label: "Услуги" },
  { value: "framework", label: "Рамочный" },
  { value: "other", label: "Прочее" },
];

export const SUPPLIER_CONTRACT_SOURCES: Array<{ value: SupplierContractExternalSource; label: string }> = [
  { value: "manual", label: "Вручную" },
  { value: "1c", label: "1С" },
  { value: "import", label: "Импорт" },
  { value: "api", label: "API" },
];

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t || undefined;
}

function cleanDate(value: unknown): string | null {
  const t = cleanText(value);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function cleanContractType(value: unknown): SupplierContractType {
  const t = cleanText(value);
  if (t === "purchase" || t === "service" || t === "framework" || t === "other") return t;
  return "supply";
}

function cleanExternalSource(value: unknown): SupplierContractExternalSource {
  const t = cleanText(value)?.toLowerCase();
  if (t === "1c" || t === "import" || t === "api") return t;
  return "manual";
}

function cleanJsonObject(value: unknown): SupplierContractMeta {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SupplierContractMeta)
    : {};
}

export function contractCodeFromName(name: string, supplierCode?: string): string {
  const prefix = supplierCode?.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 12) || "CTR";
  const raw = name
    .trim()
    .toUpperCase()
    .replace(/[^A-ZА-ЯЁ0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const base = raw || Date.now().toString(36).toUpperCase();
  return `${prefix}_${base}`.slice(0, 64);
}

export function normalizeContractCode(raw: string): string {
  const c = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (!/^[A-Z0-9_]{1,64}$/.test(c)) {
    throw new Error("code: только A–Z, цифры и _, до 64 символов");
  }
  return c;
}

export function mergeContractMeta(
  existing: SupplierContractMeta | undefined,
  patch: SupplierContractMeta | undefined
): SupplierContractMeta {
  return { ...cleanJsonObject(existing), ...cleanJsonObject(patch) };
}

export function normalizeContractInput(input: {
  code?: string;
  number?: string | null;
  name?: string;
  contractType?: string;
  validFrom?: string | null;
  validTo?: string | null;
  currency?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  externalSource?: string;
  externalId?: string | null;
  externalRef?: SupplierContractMeta;
  meta?: SupplierContractMeta;
  note?: string | null;
  supplierCode?: string;
}) {
  const name = cleanText(input.name);
  if (!name) throw new Error("name is required");
  const code = input.code?.trim()
    ? normalizeContractCode(input.code)
    : contractCodeFromName(input.number || name, input.supplierCode);
  return {
    code,
    number: cleanText(input.number) ?? null,
    name,
    contractType: cleanContractType(input.contractType),
    validFrom: cleanDate(input.validFrom),
    validTo: cleanDate(input.validTo),
    currency: cleanText(input.currency) ?? "RUB",
    isDefault: input.isDefault === true,
    isActive: input.isActive !== false,
    externalSource: cleanExternalSource(input.externalSource),
    externalId: cleanText(input.externalId) ?? null,
    externalRef: cleanJsonObject(input.externalRef),
    meta: cleanJsonObject(input.meta),
    note: cleanText(input.note) ?? null,
  };
}

export function contractSummaryLine(row: Pick<SupplierContractRow, "number" | "name" | "contractType" | "validTo">): string {
  const typeLabel = SUPPLIER_CONTRACT_TYPES.find((t) => t.value === row.contractType)?.label ?? row.contractType;
  const parts = [row.number || row.name, typeLabel];
  if (row.validTo) parts.push(`до ${row.validTo}`);
  return parts.filter(Boolean).join(" · ");
}
