import type { PoolClient } from "pg"
import type { Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { WmsUnavailable, type WmsClient, type WmsItem } from "./integrations/wms.ts"

/**
 * Сопоставление строк поставщика с номенклатурой WMS. Порядок (от надёжного к спорному):
 *  1. сохранённое соответствие EDI (ИНН поставщика + его код/наименование) — подтверждено человеком ранее;
 *  2. GTIN — штрихкод номенклатуры WMS (строгое совпадение);
 *  3. алиас WMS по коду поставщика (alias_sku) и по точному наименованию у этого поставщика;
 *  4. код номенклатуры / SKU WMS совпадает с кодом поставщика.
 * Похожие по названию позиции только предлагаются кандидатами — автоматически не подставляются.
 */

export type MatchResult = {
  itemCode: string | null
  itemName: string | null
  source: "mapping" | "gtin" | "alias_sku" | "alias_name" | "item_code" | null
  uomFactor: number
  candidates: WmsItem[]
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["'«»„“”]/g, "")
    .replace(/[\s ]+/g, " ")
    .trim()
    .slice(0, 300)
}

export function supplierKey(line: { supplierCode?: string | null; name: string }): string {
  return line.supplierCode?.trim() ? `code:${line.supplierCode.trim().toLowerCase()}` : `name:${normalizeName(line.name)}`
}

type LineForMatch = { name: string; supplierCode?: string | null; gtin?: string | null }

async function savedMapping(client: PoolClient, siteId: number, inn: string, line: LineForMatch) {
  const keys = [supplierKey(line), `name:${normalizeName(line.name)}`]
  if (line.gtin) keys.push(`gtin:${line.gtin}`)
  const r = await client.query<{ item_code: string; item_name: string | null; uom_factor: string }>(
    `SELECT item_code, item_name, uom_factor::text FROM edi_item_mappings
     WHERE site_id = $1 AND supplier_inn = $2 AND supplier_key = ANY($3::text[])
     ORDER BY array_position($3::text[], supplier_key) LIMIT 1`,
    [siteId, inn, keys]
  )
  return r.rows[0] ?? null
}

async function pool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    })
  )
  return out
}

export async function matchLines(
  client: PoolClient,
  siteId: number,
  wms: WmsClient | null,
  supplier: { inn: string | null; name: string | null; wmsSupplierCode: string | null },
  lines: LineForMatch[]
): Promise<{ results: MatchResult[]; wmsAvailable: boolean; wmsError: string | null }> {
  let wmsAvailable = Boolean(wms)
  let wmsError: string | null = wms ? null : "Интеграция с WMS не настроена"
  const results: MatchResult[] = []
  // сохранённые соответствия — из своей БД, последовательно (один client)
  const fromDb: Array<Awaited<ReturnType<typeof savedMapping>> | null> = []
  for (const l of lines) fromDb.push(supplier.inn ? await savedMapping(client, siteId, supplier.inn, l) : null)

  const viaWms = await pool(lines, 4, async (l, i): Promise<MatchResult> => {
    const m = fromDb[i]
    if (m) return { itemCode: m.item_code, itemName: m.item_name, source: "mapping", uomFactor: Number(m.uom_factor) || 1, candidates: [] }
    if (!wms || !wmsAvailable) return { itemCode: null, itemName: null, source: null, uomFactor: 1, candidates: [] }
    try {
      if (l.gtin) {
        const hit = await wms.findByGtin(l.gtin)
        if (hit) return { itemCode: hit.itemCode, itemName: hit.name, source: "gtin", uomFactor: 1, candidates: [] }
      }
      const code = l.supplierCode?.trim()
      if (code) {
        const hits = await wms.searchAliases(code, { code: supplier.wmsSupplierCode })
        const exact = hits.find((h) => (h.aliasSku ?? "").toLowerCase() === code.toLowerCase())
        if (exact) return { itemCode: exact.itemCode, itemName: exact.itemName, source: "alias_sku", uomFactor: 1, candidates: [] }
        const items = await wms.searchItems(code, 5)
        const byCode = items.find((it) => it.itemCode.toLowerCase() === code.toLowerCase() || (it.sku ?? "").toLowerCase() === code.toLowerCase())
        if (byCode) return { itemCode: byCode.itemCode, itemName: byCode.name, source: "item_code", uomFactor: 1, candidates: [] }
      }
      const nameHits = await wms.searchAliases(l.name.slice(0, 120), { code: supplier.wmsSupplierCode })
      const sameName = nameHits.filter((h) => normalizeName(h.aliasName) === normalizeName(l.name))
      const distinct = [...new Set(sameName.map((h) => h.itemCode))]
      if (distinct.length === 1) {
        return { itemCode: sameName[0].itemCode, itemName: sameName[0].itemName, source: "alias_name", uomFactor: 1, candidates: [] }
      }
      return { itemCode: null, itemName: null, source: null, uomFactor: 1, candidates: await candidatesByWords(wms, l.name) }
    } catch (e) {
      if (e instanceof WmsUnavailable) {
        wmsAvailable = false
        wmsError = e.message
        return { itemCode: null, itemName: null, source: null, uomFactor: 1, candidates: [] }
      }
      throw e
    }
  })
  results.push(...viaWms)
  return { results, wmsAvailable, wmsError }
}

/** Кандидаты по значимым словам названия, ранжированные по числу совпавших слов. Только подсказка. */
async function candidatesByWords(wms: WmsClient, name: string): Promise<WmsItem[]> {
  const words = normalizeName(name)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4)
  const scored = new Map<string, { item: WmsItem; score: number }>()
  for (const w of words.slice(0, 2)) {
    for (const it of await wms.searchItems(w, 10)) {
      const n = normalizeName(it.name)
      const score = words.filter((x) => n.includes(x)).length
      const prev = scored.get(it.itemCode)
      if (!prev || prev.score < score) scored.set(it.itemCode, { item: it, score })
    }
  }
  return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.item)
}

/** Подтверждённое человеком соответствие сохраняется в EDI и (если доступно) алиасом в WMS. */
export async function saveMapping(
  client: PoolClient,
  actor: Actor,
  wms: WmsClient | null,
  input: {
    supplierInn: string
    supplierName: string
    wmsSupplierCode?: string | null
    line: { name: string; supplierCode?: string | null; gtin?: string | null }
    itemCode: string
    itemName?: string | null
    uomFactor?: number
  }
): Promise<{ wmsAlias: "created" | "skipped" | "failed"; error?: string }> {
  const key = supplierKey(input.line)
  await client.query(
    `INSERT INTO edi_item_mappings (site_id, supplier_inn, supplier_key, supplier_code, supplier_name, gtin, item_code, item_name, uom_factor, confirmed_by, use_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::bigint, 1)
     ON CONFLICT (site_id, supplier_inn, supplier_key) DO UPDATE SET
       item_code = EXCLUDED.item_code, item_name = EXCLUDED.item_name, uom_factor = EXCLUDED.uom_factor,
       confirmed_by = EXCLUDED.confirmed_by, use_count = edi_item_mappings.use_count + 1, updated_at = now()`,
    [
      actor.siteId,
      input.supplierInn,
      key,
      input.line.supplierCode ?? null,
      input.line.name,
      input.line.gtin ?? null,
      input.itemCode,
      input.itemName ?? null,
      input.uomFactor && input.uomFactor > 0 ? input.uomFactor : 1,
      actor.userId,
    ]
  )
  await recordEvent(client, actorEvent(actor, "wms.mapping_saved", null, { supplierInn: input.supplierInn, key, itemCode: input.itemCode }))
  if (!wms) return { wmsAlias: "skipped" }
  try {
    await wms.createAlias(input.itemCode, {
      aliasName: input.line.name.slice(0, 500),
      aliasSku: input.line.supplierCode ?? null,
      gtin: input.line.gtin ?? null,
      supplierCode: input.wmsSupplierCode ?? null,
      supplierName: input.supplierName,
    })
    return { wmsAlias: "created" }
  } catch (e) {
    return { wmsAlias: "failed", error: e instanceof Error ? e.message : String(e) }
  }
}
