import { getSiteCode } from "@/lib/wms-api"
import type { LabelSuzProductGroup, LabelSuzSettings } from "@/lib/wms/label-suz-settings"

/** Шаблоны КМ, которые уже стоят на этом складе в настройках СУЗ. */
export const SUZ_TEMPLATE_BY_GROUP: Record<LabelSuzProductGroup, number> = {
  water: 16,
  softdrinks: 29,
}

export const SUZ_GROUP_LABEL: Record<LabelSuzProductGroup, string> = {
  water: "Вода",
  softdrinks: "Напитки",
}

export type SuzGroupSource = "nomenclature" | "crpt" | "settings"

export type ResolvedSuzGroup = {
  productGroup: LabelSuzProductGroup
  templateId: number
  source: SuzGroupSource
  label: string
}

/** Вода и напитки в ЧЗ — разные товарные группы. Неверная группа = отказ СУЗ. */
export function parseSuzProductGroup(raw: unknown): LabelSuzProductGroup | null {
  const token = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^товарная группа\s+/i, "")
    .replace(/\s+/g, " ")
  if (!token) return null
  if (
    token === "water" ||
    token === "вода" ||
    token === "упакованная вода" ||
    token === "упакованные воды" ||
    (token.includes("упакованн") && token.includes("вод"))
  ) {
    return "water"
  }
  if (
    token === "softdrinks" ||
    token === "juice" ||
    token === "напитки" ||
    token === "безалкогольные напитки" ||
    token === "соки" ||
    token === "соковая продукция"
  ) {
    return "softdrinks"
  }
  return null
}

/**
 * Если в карточке нет поля ЧЗ — берём группу из названия/GTIN-описания.
 * «Вода минеральная…» → water, «Напиток безалкогольный…» → softdrinks.
 * Название не должно перебивать явное поле и ответ True API.
 */
/** `\b` в JS не видит кириллицу — границы слова задаём сами. */
function hasCyrWord(text: string, stem: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${stem}([^\\p{L}\\p{N}]|$)`, "iu").test(text)
}

export function inferSuzGroupFromProductName(raw: unknown): LabelSuzProductGroup | null {
  const text = String(raw ?? "").trim().toLowerCase()
  if (!text) return null
  if (parseSuzProductGroup(text)) return parseSuzProductGroup(text)
  const drink =
    hasCyrWord(text, "напит(?:ок|ки|ков)") ||
    text.includes("безалкогол") ||
    text.includes("сокосодерж") ||
    text.includes("соковая")
  const water =
    hasCyrWord(text, "вод[аыеуо]") ||
    text.includes("питьев") ||
    text.includes("минеральн") ||
    text.includes("курортн") ||
    (text.includes("детского питания") && text.includes("вод"))
  if (drink && !water) return "softdrinks"
  if (water && !drink) return "water"
  if (drink) return "softdrinks"
  return null
}

export function applySuzGroup(
  productGroup: LabelSuzProductGroup,
  source: SuzGroupSource,
  settings?: Pick<LabelSuzSettings, "templateId">
): ResolvedSuzGroup {
  const mapped = SUZ_TEMPLATE_BY_GROUP[productGroup]
  const templateId =
    source === "settings" && settings?.templateId && settings.templateId > 0
      ? settings.templateId
      : mapped
  return {
    productGroup,
    templateId,
    source,
    label: SUZ_GROUP_LABEL[productGroup],
  }
}

export function resolveSuzGroupFromHints(
  hints: Array<unknown>,
  settings: Pick<LabelSuzSettings, "productGroup" | "templateId">
): ResolvedSuzGroup {
  for (const hint of hints) {
    const parsed = parseSuzProductGroup(hint)
    if (parsed) return applySuzGroup(parsed, "nomenclature", settings)
  }
  return applySuzGroup(settings.productGroup, "settings", settings)
}

function crptGroupFromResult(row: Record<string, unknown>): LabelSuzProductGroup | null {
  const candidates = [
    row.productGroup,
    row.product_group,
    row.goodMarkType,
    Array.isArray(row.productGroups) ? row.productGroups[0] : null,
    Array.isArray(row.productGroupIds) ? row.productGroupIds[0] : null,
  ]
  for (const value of candidates) {
    const parsed = parseSuzProductGroup(value)
    if (parsed) return parsed
  }
  return (
    inferSuzGroupFromProductName(row.name) ||
    inferSuzGroupFromProductName(row.productName) ||
    inferSuzGroupFromProductName(row.goodName)
  )
}

/** Карточка GTIN в True API: POST /api/v4/true-api/product/info */
export async function fetchSuzGroupFromCrpt(gtin: string): Promise<LabelSuzProductGroup | null> {
  const normalized = gtin.replace(/\D/g, "").padStart(14, "0").slice(-14)
  if (!/^\d{14}$/.test(normalized)) return null
  try {
    const res = await fetch("/api/wms/crpt/product-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ gtins: [normalized] }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      results?: Array<Record<string, unknown>>
      products?: Array<Record<string, unknown>>
    }
    const rows = data.results ?? data.products ?? []
    const hit =
      rows.find((row) => String(row.gtin ?? "").replace(/\D/g, "").padStart(14, "0").slice(-14) === normalized) ??
      rows[0]
    if (!hit) return null
    return crptGroupFromResult(hit)
  } catch {
    return null
  }
}

async function fetchSuzGroupFromNomenclature(gtin: string): Promise<LabelSuzProductGroup | null> {
  const normalized = gtin.replace(/\D/g, "").padStart(14, "0").slice(-14)
  if (!/^\d{14}$/.test(normalized)) return null
  try {
    const qp = new URLSearchParams({
      siteCode: getSiteCode(),
      query: normalized,
      limit: "8",
    })
    const res = await fetch(`/api/wms/label-code-orders/nomenclature?${qp}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      items?: Array<{
        gtin?: string
        name?: string
        productGroup?: string | null
        itemGroupCode?: string | null
      }>
    }
    for (const item of data.items ?? []) {
      const itemGtin = String(item.gtin ?? "").replace(/\D/g, "").padStart(14, "0").slice(-14)
      if (itemGtin && itemGtin !== normalized) continue
      const parsed =
        parseSuzProductGroup(item.productGroup) ||
        parseSuzProductGroup(item.itemGroupCode) ||
        inferSuzGroupFromProductName(item.name)
      if (parsed) return parsed
    }
    return null
  } catch {
    return null
  }
}

export async function resolveSuzGroupForOrder(input: {
  gtin: string
  hints?: unknown[]
  settings: Pick<LabelSuzSettings, "productGroup" | "templateId">
}): Promise<ResolvedSuzGroup> {
  const fromNom = await fetchSuzGroupFromNomenclature(input.gtin)
  if (fromNom) return applySuzGroup(fromNom, "nomenclature", input.settings)
  const fromCrpt = await fetchSuzGroupFromCrpt(input.gtin)
  if (fromCrpt) return applySuzGroup(fromCrpt, "crpt", input.settings)
  for (const hint of input.hints ?? []) {
    const parsed = parseSuzProductGroup(hint) || inferSuzGroupFromProductName(hint)
    if (parsed) return applySuzGroup(parsed, "nomenclature", input.settings)
  }
  return applySuzGroup(input.settings.productGroup, "settings", input.settings)
}
