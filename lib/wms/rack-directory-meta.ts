import { sortSequentialCellCodes } from "@/lib/wms/workshop-waiting-cell";

export type RackMeta = Record<string, unknown>;

export type RackCellRow = {
  locationId: string;
  locationCode: string;
  displayName: string;
  physicalAddress: string | null;
  sortOrder: number;
};

export type RackDirectoryRow = {
  rackId: string;
  code: string;
  name: string;
  addressLabel: string | null;
  warehouseCode: string | null;
  zoneCode: string | null;
  meta: RackMeta;
  isActive: boolean;
  cellCount: number;
  cells: RackCellRow[];
  createdAt: string;
  updatedAt: string;
};

/** Payload для QR стеллажа / ТСД. */
export type RackScanPayload = {
  v: 1;
  kind: "wms_rack";
  site: string;
  rack: string;
  cells: string[];
};

/** Короткое содержимое QR на этикетке — только код стеллажа (сканируется любым приложением). */
export function buildRackQrContent(rackCode: string): string {
  return rackCode.trim().toUpperCase();
}

/** Полный JSON для ТСД — со списком ячеек (не кодируется в QR при большом стеллаже). */
export function buildRackScanPayload(siteCode: string, rackCode: string, cellCodes: string[]): string {
  const payload: RackScanPayload = {
    v: 1,
    kind: "wms_rack",
    site: siteCode.trim() || "DEFAULT",
    rack: rackCode.trim().toUpperCase(),
    cells: sortSequentialCellCodes([...new Set(cellCodes.map((c) => c.trim()).filter(Boolean))]),
  };
  return JSON.stringify(payload);
}

export function parseRackScanPayload(raw: string, defaultSite = "DEFAULT"): RackScanPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^RACK[_-]/i.test(trimmed)) {
    return {
      v: 1,
      kind: "wms_rack",
      site: defaultSite.trim() || "DEFAULT",
      rack: trimmed.toUpperCase(),
      cells: [],
    };
  }

  try {
    const v = JSON.parse(trimmed) as RackScanPayload;
    if (v?.v === 1 && v.kind === "wms_rack" && typeof v.rack === "string") {
      return {
        v: 1,
        kind: "wms_rack",
        site: (typeof v.site === "string" ? v.site.trim() : "") || defaultSite.trim() || "DEFAULT",
        rack: v.rack.trim().toUpperCase(),
        cells: Array.isArray(v.cells)
          ? sortSequentialCellCodes([...new Set(v.cells.map((c) => String(c).trim()).filter(Boolean))])
          : [],
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Из physicalAddress «A01-01» → «A01». */
export function rackPrefixFromPhysicalAddress(physicalAddress: string | null | undefined): string | null {
  const t = physicalAddress?.trim();
  if (!t) return null;
  const head = t.split(/[-/\\s]+/)[0]?.trim();
  return head ? head.toUpperCase() : null;
}

export function defaultRackMeta(): RackMeta {
  return {};
}

export function mergeRackMeta(existing: RackMeta | undefined, patch: RackMeta | undefined): RackMeta {
  return { ...(existing ?? {}), ...(patch ?? {}) };
}

export function rackCodeFromLabel(label: string): string {
  const raw = label
    .trim()
    .toUpperCase()
    .replace(/[^A-ZА-ЯЁ0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  if (!raw) return `RACK_${Date.now().toString(36).toUpperCase()}`;
  return raw.startsWith("RACK_") ? raw : `RACK_${raw}`;
}

export function normalizeRackCode(raw: string): string {
  const c = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (!/^[A-Z0-9_А-ЯЁ-]{1,64}$/.test(c)) {
    throw new Error("code: буквы, цифры, _, до 64 символов");
  }
  return c;
}
