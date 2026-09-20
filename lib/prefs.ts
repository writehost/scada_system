import type { ColumnSizingState, VisibilityState } from "@tanstack/react-table";

const SITE_ID = "scadatable_site_id_v1";
const WMS_SITE_CODE = "scadatable_wms_site_code_v1";

/** Ключ `localStorage` для вида сетки реестра; слушать в `storage` для синхронизации вкладок. */
export const REGISTRY_TABLE_PREFS_KEY = "scadatable_registry_table_v1";

/** Плотность строк сетки реестра (сохраняется в localStorage). */
export type RegistryTableDensity = "compact" | "normal";

export interface RegistryTablePrefs {
  columnVisibility?: VisibilityState;
  columnSizing?: ColumnSizingState;
  density?: RegistryTableDensity;
}

/** Приводит сохранённый JSON к состоянию для TanStack Table (пустые объекты = по умолчанию). */
export function normalizedRegistryTablePrefs(
  p: RegistryTablePrefs | null
): {
  columnVisibility: VisibilityState;
  columnSizing: ColumnSizingState;
  density: RegistryTableDensity;
} {
  const cv = p?.columnVisibility;
  const columnVisibility =
    cv && typeof cv === "object" && Object.keys(cv).length > 0 ? cv : {};
  const cs = p?.columnSizing;
  const columnSizing =
    cs && typeof cs === "object" && Object.keys(cs).length > 0 ? cs : {};
  const density =
    p?.density === "compact" || p?.density === "normal" ? p.density : "normal";
  return { columnVisibility, columnSizing, density };
}

export function loadSiteId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(SITE_ID);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveSiteId(id: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SITE_ID, id);
  } catch {
    /* ignore */
  }
}

export function loadWmsSiteCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(WMS_SITE_CODE);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveWmsSiteCode(siteCode: string) {
  if (typeof window === "undefined") return;
  try {
    const normalized = siteCode.trim();
    if (normalized.length === 0) {
      localStorage.removeItem(WMS_SITE_CODE);
      return;
    }
    localStorage.setItem(WMS_SITE_CODE, normalized);
  } catch {
    /* ignore */
  }
}

export function deserializeRegistryTablePrefs(
  raw: string | null
): RegistryTablePrefs | null {
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as RegistryTablePrefs;
  } catch {
    return null;
  }
}

export function loadRegistryTablePrefs(): RegistryTablePrefs | null {
  if (typeof window === "undefined") return null;
  try {
    return deserializeRegistryTablePrefs(
      localStorage.getItem(REGISTRY_TABLE_PREFS_KEY)
    );
  } catch {
    return null;
  }
}

export function saveRegistryTablePrefs(prefs: RegistryTablePrefs) {
  if (typeof window === "undefined") return;
  try {
    const vis = prefs.columnVisibility ?? {};
    const sizing = prefs.columnSizing ?? {};
    const dens = prefs.density ?? "normal";
    const isDefault =
      Object.keys(vis).length === 0 &&
      Object.keys(sizing).length === 0 &&
      dens === "normal";
    if (isDefault) {
      localStorage.removeItem(REGISTRY_TABLE_PREFS_KEY);
      return;
    }
    localStorage.setItem(REGISTRY_TABLE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function clearRegistryTablePrefs() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(REGISTRY_TABLE_PREFS_KEY);
  } catch {
    /* ignore */
  }
}
