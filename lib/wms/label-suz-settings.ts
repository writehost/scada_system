/**
 * Настройки заказа кодов в СУЗ для WMS.
 * omsId/clientToken и запасная товарная группа лежат в базе склада;
 * lastCertThumbprint остаётся на этом рабочем месте (localStorage).
 */

export type LabelSuzProductGroup = "water" | "softdrinks"

export type LabelSuzSettings = {
  omsId: string
  clientToken: string
  suzBaseUrl: string
  productGroup: LabelSuzProductGroup
  templateId: number
  serialNumberType: "OPERATOR" | "OPERATOR_OR_PROVIDER" | "PROVIDER"
  cisType: "UNIT" | "GROUP" | "SET"
  lastCertThumbprint: string
}

export const DEFAULT_LABEL_SUZ_SETTINGS: LabelSuzSettings = {
  omsId: "cdf12109-10d3-11e6-8b6f-0050569977a1",
  clientToken: "",
  suzBaseUrl: "https://suzgrid.crpt.ru",
  productGroup: "softdrinks",
  templateId: 29,
  serialNumberType: "OPERATOR",
  cisType: "UNIT",
  lastCertThumbprint: "",
}

const LS_KEY = "wms.labelSuz.settings.v1"

const SUZ_TEMPLATE_FALLBACK: Record<LabelSuzProductGroup, number> = {
  water: 16,
  softdrinks: 29,
}

export function parseLabelSuzSettings(raw: unknown): LabelSuzSettings {
  const parsed = (raw ?? {}) as Partial<LabelSuzSettings>
  const pg = parsed.productGroup === "water" || parsed.productGroup === "softdrinks" ? parsed.productGroup : "softdrinks"
  const templateId = Number(parsed.templateId)
  return {
    omsId: String(parsed.omsId || DEFAULT_LABEL_SUZ_SETTINGS.omsId).trim() || DEFAULT_LABEL_SUZ_SETTINGS.omsId,
    clientToken: String(parsed.clientToken || "").trim(),
    suzBaseUrl:
      String(parsed.suzBaseUrl || DEFAULT_LABEL_SUZ_SETTINGS.suzBaseUrl).trim().replace(/\/+$/, "") ||
      DEFAULT_LABEL_SUZ_SETTINGS.suzBaseUrl,
    productGroup: pg,
    templateId: Number.isFinite(templateId) && templateId > 0 ? Math.floor(templateId) : SUZ_TEMPLATE_FALLBACK[pg],
    serialNumberType:
      parsed.serialNumberType === "PROVIDER" || parsed.serialNumberType === "OPERATOR_OR_PROVIDER"
        ? parsed.serialNumberType
        : "OPERATOR",
    cisType: parsed.cisType === "GROUP" || parsed.cisType === "SET" ? parsed.cisType : "UNIT",
    lastCertThumbprint: String(parsed.lastCertThumbprint || "").trim(),
  }
}

export function loadLabelSuzSettings(): LabelSuzSettings {
  if (typeof window === "undefined") return { ...DEFAULT_LABEL_SUZ_SETTINGS }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { ...DEFAULT_LABEL_SUZ_SETTINGS }
    return parseLabelSuzSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_LABEL_SUZ_SETTINGS }
  }
}

export function saveLabelSuzSettings(next: LabelSuzSettings): void {
  if (typeof window === "undefined") return
  localStorage.setItem(LS_KEY, JSON.stringify(next))
}

/** Складываем серверные реквизиты с отпечатком сертификата этого браузера. */
export function mergeLabelSuzSettings(
  server: Partial<LabelSuzSettings> | null | undefined,
  local: LabelSuzSettings = loadLabelSuzSettings()
): LabelSuzSettings {
  if (!server) return local
  const fromServer = parseLabelSuzSettings(server)
  return {
    ...fromServer,
    lastCertThumbprint: local.lastCertThumbprint || fromServer.lastCertThumbprint,
  }
}

export function cisTypeFromSticker(stickerType: string | undefined, fallback: LabelSuzSettings["cisType"]): LabelSuzSettings["cisType"] {
  const s = (stickerType || "").toLowerCase()
  if (s.includes("group") || s.includes("групп")) return "GROUP"
  if (s.includes("set") || s.includes("набор")) return "SET"
  if (s.includes("unit") || s.includes("single") || s.includes("единич")) return "UNIT"
  return fallback
}
