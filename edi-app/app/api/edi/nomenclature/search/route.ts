import { route } from "@/lib/http.ts"
import { WmsUnavailable, wmsClientFor } from "@/lib/edi/integrations/wms.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Поиск номенклатуры WMS: название, артикул/код, GTIN, алиасы поставщика. */
export const GET = route(async ({ client, actor, req }) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim()
  if (q.length < 2) return { items: [], available: true }
  const wms = await wmsClientFor(client, actor.siteId, actor.siteCode)
  if (!wms) return { items: [], available: false, error: "Интеграция с WMS не настроена" }
  try {
    const items = new Map<string, { itemCode: string; name: string; sku: string | null; uomCode: string | null; via: string }>()
    if (/^\d{8,14}$/.test(q)) {
      const g = await wms.findByGtin(q)
      if (g) items.set(g.itemCode, { ...g, via: "GTIN" })
    }
    for (const it of await wms.searchItems(q, 20)) if (!items.has(it.itemCode)) items.set(it.itemCode, { ...it, via: "номенклатура" })
    for (const a of await wms.searchAliases(q)) {
      if (!items.has(a.itemCode)) items.set(a.itemCode, { itemCode: a.itemCode, name: a.itemName, sku: a.aliasSku, uomCode: null, via: `алиас: ${a.aliasName}` })
    }
    return { items: [...items.values()].slice(0, 30), available: true }
  } catch (e) {
    if (e instanceof WmsUnavailable) return { items: [], available: false, error: e.message }
    throw e
  }
})
