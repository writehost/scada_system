export type SupplierAddressMeta = {
  legal?: string;
  actual?: string;
  delivery?: string;
  postal?: string;
};

export type SupplierMeta = {
  legalName?: string;
  kpp?: string;
  ogrn?: string;
  addresses?: SupplierAddressMeta;
  phone?: string;
  email?: string;
  contactPerson?: string;
  website?: string;
  bankName?: string;
  bankBik?: string;
  bankAccount?: string;
  corrAccount?: string;
  note?: string;
};

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t || undefined;
}

export function defaultSupplierMeta(): SupplierMeta {
  return {
    legalName: "",
    kpp: "",
    ogrn: "",
    addresses: {},
    phone: "",
    email: "",
    contactPerson: "",
    website: "",
    bankName: "",
    bankBik: "",
    bankAccount: "",
    corrAccount: "",
    note: "",
  };
}

export function mergeSupplierMeta(
  existing: Record<string, unknown> | undefined,
  patch: SupplierMeta | Record<string, unknown> | undefined
): SupplierMeta {
  const base = defaultSupplierMeta();
  const prev = (existing ?? {}) as SupplierMeta;
  const next = (patch ?? {}) as SupplierMeta;
  const prevAddr = prev.addresses ?? {};
  const nextAddr = next.addresses ?? {};

  return {
    ...base,
    ...prev,
    ...next,
    legalName: cleanText(next.legalName) ?? cleanText(prev.legalName) ?? "",
    kpp: cleanText(next.kpp) ?? cleanText(prev.kpp) ?? "",
    ogrn: cleanText(next.ogrn) ?? cleanText(prev.ogrn) ?? "",
    phone: cleanText(next.phone) ?? cleanText(prev.phone) ?? "",
    email: cleanText(next.email) ?? cleanText(prev.email) ?? "",
    contactPerson: cleanText(next.contactPerson) ?? cleanText(prev.contactPerson) ?? "",
    website: cleanText(next.website) ?? cleanText(prev.website) ?? "",
    bankName: cleanText(next.bankName) ?? cleanText(prev.bankName) ?? "",
    bankBik: cleanText(next.bankBik) ?? cleanText(prev.bankBik) ?? "",
    bankAccount: cleanText(next.bankAccount) ?? cleanText(prev.bankAccount) ?? "",
    corrAccount: cleanText(next.corrAccount) ?? cleanText(prev.corrAccount) ?? "",
    note: cleanText(next.note) ?? cleanText(prev.note) ?? "",
    addresses: {
      legal: cleanText(nextAddr.legal) ?? cleanText(prevAddr.legal) ?? "",
      actual: cleanText(nextAddr.actual) ?? cleanText(prevAddr.actual) ?? "",
      delivery: cleanText(nextAddr.delivery) ?? cleanText(prevAddr.delivery) ?? "",
      postal: cleanText(nextAddr.postal) ?? cleanText(prevAddr.postal) ?? "",
    },
  };
}

export function supplierPrimaryAddress(meta: SupplierMeta | undefined): string {
  const a = meta?.addresses;
  return (
    a?.delivery?.trim() ||
    a?.actual?.trim() ||
    a?.legal?.trim() ||
    a?.postal?.trim() ||
    ""
  );
}

export function supplierContactLine(meta: SupplierMeta | undefined): string {
  const parts = [meta?.contactPerson, meta?.phone, meta?.email].map((x) => x?.trim()).filter(Boolean);
  return parts.join(" · ");
}
