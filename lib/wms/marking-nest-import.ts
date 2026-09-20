import type { PoolClient } from "pg"
import { normalizeCrptCode } from "@/lib/wms/crpt"
import {
  relinkStubMarkingCodesToProduct,
  resolveFinishedGoodsProductItem,
  type MarkingPackagingGtins,
} from "@/lib/wms/marking-product-resolve"
import { xxhash64Signed } from "@/lib/wms/xxhash64"

const GS = "\x1d"

export type NestImportEntry = {
  Parent?: string | null
  ParentProductTypeId?: string | null
  IdentificationCode?: string
  ProductTypeId?: string
  ChildrenProductTypeId?: string | null
  ChildrenIdentificationCodes?: string[]
  IsTempCode?: boolean
}

export type MarkingPackLevel = "pallet" | "block" | "unit"

export type ParsedMarkingCode = {
  identificationCode: string
  /** Все строковые представления одного кода (дубликаты в JSON). */
  aliases: string[]
  gtin: string
  serial: string
  ai93: Buffer | null
  raw: Buffer
  rawHash: string
  baseHash: string
  level: MarkingPackLevel
  productTypeId: string | null
  parentCode: string | null
}

export type NestImportPreview = {
  pallets: number
  blocks: number
  units: number
  total: number
  gtins: string[]
  productTypeLevels: Record<string, MarkingPackLevel>
  skippedTemp: number
  parseErrors: string[]
}

export type NestImportResult = {
  inserted: number
  existing: number
  linked: number
  itemsCreated: number
  stockAdjusted: number
  errors: string[]
}

function findSerialEnd(after21: string): number {
  const gs = after21.indexOf(GS)
  if (gs >= 0) return gs
  return after21.length
}

function parseGs1Marked(raw: string): { gtin: string; serial: string; ai93: Buffer | null } | null {
  const text = raw.replace(/\u0000/g, "")
  const i01 = text.indexOf("01")
  if (i01 < 0 || i01 + 16 > text.length) return null
  const gtin = text.slice(i01 + 2, i01 + 16)
  if (!/^\d{14}$/.test(gtin)) return null

  const rest = text.slice(i01 + 16)
  const i21 = rest.indexOf("21")
  if (i21 < 0) return { gtin, serial: "", ai93: null }

  const after21 = rest.slice(i21 + 2)
  const serialEnd = findSerialEnd(after21)
  const serial = after21.slice(0, serialEnd)
  if (!serial) return null

  let ai93: Buffer | null = null
  let tail = after21.slice(serialEnd)
  if (tail.startsWith(GS)) tail = tail.slice(1)
  const i93 = tail.indexOf("93")
  if (i93 >= 0) {
    ai93 = Buffer.from(tail.slice(i93 + 2), "latin1")
  }

  return { gtin, serial, ai93 }
}

function parseSscc(raw: string): { gtin: string; serial: string } | null {
  const code = raw.trim()
  if (!/^00\d{18}$/.test(code)) return null
  return { gtin: code.slice(0, 14), serial: code.slice(14) }
}

export function detectPackLevel(code: string, productTypeId?: string | null): MarkingPackLevel {
  const c = code.trim()
  if (/^00\d{18}$/.test(c)) return "pallet"
  const typeHint = (productTypeId || "").trim().toUpperCase()
  if (typeHint === "PALLET" || typeHint.includes("PALLET")) return "pallet"
  if (typeHint === "BLOCK" || typeHint.includes("BLOCK") || typeHint.includes("BOX")) return "block"
  if (typeHint === "UNIT" || typeHint.includes("UNIT") || typeHint.includes("ITEM")) return "unit"
  const gs1 = parseGs1Marked(c)
  if (!gs1) return "unit"
  // Известные GTIN блока/единицы (софтдринкс / сливы и соседние партии)
  if (gs1.gtin.startsWith("046070171623") || gs1.gtin === "04607017163481") return "block"
  if (gs1.gtin.startsWith("046070171614") || gs1.gtin === "04607017160190") return "unit"
  if (productTypeId) return "unit"
  return "unit"
}

/**
 * True API / СЕЗАКМ: { productGroup, aggregationUnits: [{ unitSerialNumber, sntins[] }] }
 * → записи nest-import (палета → блок → единица).
 */
export function convertCrptAggregationToNestEntries(doc: unknown): NestImportEntry[] | null {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null
  const root = doc as Record<string, unknown>
  const units = root.aggregationUnits
  if (!Array.isArray(units) || units.length === 0) return null

  const parentCodes = new Set<string>()
  for (const raw of units) {
    if (!raw || typeof raw !== "object") continue
    const parent = asText((raw as Record<string, unknown>).unitSerialNumber)
    if (parent) parentCodes.add(parent)
  }

  const entries: NestImportEntry[] = []
  for (const raw of units) {
    if (!raw || typeof raw !== "object") continue
    const u = raw as Record<string, unknown>
    const parent = asText(u.unitSerialNumber)
    if (!parent) continue
    const children = Array.isArray(u.sntins)
      ? u.sntins.map((c) => asText(c)).filter(Boolean)
      : []
    if (children.length === 0) continue

    const parentIsSscc = /^00\d{18}$/.test(parent)
    // Если дети сами встречаются как родители агрегации — это палета→блок, иначе блок→единица.
    const childrenAreParents = children.some((c) => parentCodes.has(c))
    const isPallet = parentIsSscc || childrenAreParents

    entries.push({
      IdentificationCode: parent,
      ProductTypeId: isPallet ? "PALLET" : "BLOCK",
      ChildrenProductTypeId: isPallet ? "BLOCK" : "UNIT",
      ChildrenIdentificationCodes: children,
    })
  }

  return entries.length > 0 ? entries : null
}

/** Принимает массив nest-записей или документ агрегации ЧЗ. */
export function normalizeNestImportEntries(input: unknown): NestImportEntry[] {
  if (Array.isArray(input)) return input as NestImportEntry[]
  const converted = convertCrptAggregationToNestEntries(input)
  if (converted) return converted
  return []
}

function reconstructBase(gtin: string, serial: string): Buffer {
  return Buffer.from(`01${gtin}${serial}`, "latin1")
}

export function parseMarkingIdentificationCode(
  identificationCode: string,
  productTypeId?: string | null
): Omit<ParsedMarkingCode, "level" | "productTypeId" | "parentCode"> | null {
  const raw = Buffer.from(identificationCode, "latin1")
  const rawHash = xxhash64Signed(raw)

  const sscc = parseSscc(identificationCode)
  if (sscc) {
    const baseHash = xxhash64Signed(raw)
    return {
      identificationCode,
      gtin: sscc.gtin,
      serial: sscc.serial,
      ai93: null,
      raw,
      rawHash,
      baseHash,
    }
  }

  const gs1 = parseGs1Marked(identificationCode)
  if (!gs1 || !gs1.serial) return null
  const baseHash = xxhash64Signed(reconstructBase(gs1.gtin, gs1.serial))
  return {
    identificationCode,
    gtin: gs1.gtin,
    serial: gs1.serial,
    ai93: gs1.ai93,
    raw,
    rawHash,
    baseHash,
  }
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

export function buildNestImportPlan(entries: NestImportEntry[]): {
  codes: ParsedMarkingCode[]
  preview: NestImportPreview
} {
  const productTypeLevels: Record<string, MarkingPackLevel> = {}
  const parentByCode = new Map<string, string | null>()
  const productTypeByCode = new Map<string, string | null>()
  const skippedTemp = { n: 0 }
  const parseErrors: string[] = []

  for (const entry of entries) {
    if (entry.IsTempCode) {
      skippedTemp.n += 1
      continue
    }
    const selfCode = asText(entry.IdentificationCode)
    if (!selfCode) continue

    const selfLevel = detectPackLevel(selfCode, entry.ProductTypeId)
    if (entry.ProductTypeId) productTypeLevels[entry.ProductTypeId] = selfLevel

    const parent = asText(entry.Parent) || null
    if (!parentByCode.has(selfCode) || parent) {
      parentByCode.set(selfCode, parent)
    }
    productTypeByCode.set(selfCode, asText(entry.ProductTypeId) || null)

    const childTypeId = asText(entry.ChildrenProductTypeId) || null
    if (childTypeId && entry.ChildrenProductTypeId) {
      const childLevel: MarkingPackLevel =
        selfLevel === "pallet" ? "block" : selfLevel === "block" ? "unit" : "unit"
      productTypeLevels[childTypeId] = childLevel
    }

    for (const childRaw of entry.ChildrenIdentificationCodes ?? []) {
      const childCode = asText(childRaw)
      if (!childCode) continue
      if (!parentByCode.has(childCode)) {
        parentByCode.set(childCode, selfCode)
      }
      if (childTypeId && !productTypeByCode.has(childCode)) {
        productTypeByCode.set(childCode, childTypeId)
      }
    }
  }

  const codes: ParsedMarkingCode[] = []
  const gtinSet = new Set<string>()
  const byGtinSerial = new Map<string, ParsedMarkingCode>()

  for (const [identificationCode, parentCode] of parentByCode) {
    const productTypeId = productTypeByCode.get(identificationCode) ?? null
    const level =
      productTypeId && productTypeLevels[productTypeId]
        ? productTypeLevels[productTypeId]!
        : detectPackLevel(identificationCode, productTypeId)

    const parsed = parseMarkingIdentificationCode(identificationCode, productTypeId)
    if (!parsed) {
      parseErrors.push(`Не удалось разобрать код: ${formatMarkingCodeDisplay(identificationCode)}`)
      continue
    }
    gtinSet.add(parsed.gtin)

    const dedupeKey = `${parsed.gtin}\0${parsed.serial}`
    const existing = byGtinSerial.get(dedupeKey)
    if (!existing) {
      const row: ParsedMarkingCode = {
        ...parsed,
        aliases: [identificationCode],
        level,
        productTypeId,
        parentCode,
      }
      byGtinSerial.set(dedupeKey, row)
      codes.push(row)
      continue
    }

    existing.aliases.push(identificationCode)
    if (parentCode && !existing.parentCode) existing.parentCode = parentCode
    if (!existing.productTypeId && productTypeId) existing.productTypeId = productTypeId
  }

  const preview: NestImportPreview = {
    pallets: codes.filter((c) => c.level === "pallet").length,
    blocks: codes.filter((c) => c.level === "block").length,
    units: codes.filter((c) => c.level === "unit").length,
    total: codes.length,
    gtins: [...gtinSet].sort(),
    productTypeLevels,
    skippedTemp: skippedTemp.n,
    parseErrors,
  }

  return { codes, preview }
}

export function formatMarkingCodeDisplay(code: string): string {
  return code.replace(/\u001d/g, "␝")
}

export function previewNestImportDocument(entries: unknown): NestImportPreview {
  const normalized = normalizeNestImportEntries(entries)
  if (normalized.length === 0) {
    return {
      pallets: 0,
      blocks: 0,
      units: 0,
      total: 0,
      gtins: [],
      productTypeLevels: {},
      skippedTemp: 0,
      parseErrors: ["Ожидается JSON-массив nest-записей или документ aggregationUnits (ЧЗ/СЕЗАКМ)"],
    }
  }
  return buildNestImportPlan(normalized).preview
}

export function inferPackagingGtinsFromCodes(codes: ParsedMarkingCode[]): MarkingPackagingGtins {
  const unit = codes.find((c) => c.level === "unit")?.gtin
  const block = codes.find((c) => c.level === "block")?.gtin
  const palletGtin = codes.find((c) => c.level === "pallet")?.gtin
  return {
    unitGtin: unit,
    blockGtin: block,
    palletGtinPrefix: palletGtin?.startsWith("003") ? palletGtin.slice(0, 14) : palletGtin,
  }
}

async function getOrCreateMarkingProductId(client: PoolClient, gtin: string): Promise<number> {
  const ins = await client.query<{ product_id: number }>(
    `INSERT INTO marking_products (gtin) VALUES ($1::char(14))
     ON CONFLICT (gtin) DO UPDATE SET gtin = EXCLUDED.gtin
     RETURNING product_id`,
    [gtin.padStart(14, "0").slice(-14)]
  )
  return ins.rows[0]!.product_id
}

async function ensureMarkingProducts(client: PoolClient, gtins: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  for (const gtin of gtins) {
    map.set(gtin, await getOrCreateMarkingProductId(client, gtin))
  }
  return map
}

const IMPORT_CHUNK = 400

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

type ExistingCodeMaps = {
  byRaw: Map<string, string>
  byBase: Map<string, string>
  byGtinSerial: Map<string, string>
}

async function preloadExistingCodes(client: PoolClient, codes: ParsedMarkingCode[]): Promise<ExistingCodeMaps> {
  const byRaw = new Map<string, string>()
  const byBase = new Map<string, string>()
  const byGtinSerial = new Map<string, string>()

  for (const chunk of chunkArray(codes, IMPORT_CHUNK)) {
    const rawHashes = chunk.map((c) => c.rawHash)
    const baseHashes = chunk.map((c) => c.baseHash)
    const gtins = chunk.map((c) => c.gtin)
    const serials = chunk.map((c) => c.serial)

    const r = await client.query<{
      code_id: string
      raw_hash: string | null
      base_hash: string | null
      ai01_gtin: string
      ai21_serial: string
    }>(
      `SELECT code_id::text, raw_hash::text, base_hash::text, ai01_gtin, ai21_serial
       FROM codes
       WHERE raw_hash = ANY($1::bigint[])
          OR base_hash = ANY($2::bigint[])
          OR (ai01_gtin, ai21_serial) IN (
            SELECT * FROM unnest($3::char(14)[], $4::text[])
          )`,
      [rawHashes, baseHashes, gtins, serials]
    )

    for (const row of r.rows) {
      if (row.raw_hash) byRaw.set(row.raw_hash, row.code_id)
      if (row.base_hash) byBase.set(row.base_hash, row.code_id)
      byGtinSerial.set(`${row.ai01_gtin}\0${row.ai21_serial}`, row.code_id)
    }
  }

  return { byRaw, byBase, byGtinSerial }
}

function resolveExistingCodeId(code: ParsedMarkingCode, maps: ExistingCodeMaps): string | null {
  return (
    maps.byRaw.get(code.rawHash) ??
    maps.byBase.get(code.baseHash) ??
    maps.byGtinSerial.get(`${code.gtin}\0${code.serial}`) ??
    null
  )
}

function registerCodeAliases(code: ParsedMarkingCode, codeId: string, map: Map<string, string>) {
  map.set(code.identificationCode, codeId)
  for (const alias of code.aliases) map.set(alias, codeId)
}

async function batchInsertCodes(
  client: PoolClient,
  chunk: ParsedMarkingCode[],
  productByGtin: Map<string, number>,
  poolId: number | null
): Promise<Array<{ code_id: string; raw_hash: string; inserted: boolean }>> {
  if (chunk.length === 0) return []

  const gtins = chunk.map((c) => c.gtin)
  const serials = chunk.map((c) => c.serial)
  const ai93s = chunk.map((c) => c.ai93)
  const raws = chunk.map((c) => c.raw)
  const rawHashes = chunk.map((c) => c.rawHash)
  const baseHashes = chunk.map((c) => c.baseHash)
  const productIds = chunk.map((c) => productByGtin.get(c.gtin) ?? null)
  const poolIds = chunk.map(() => poolId)

  const r = await client.query<{ code_id: string; raw_hash: string; inserted: boolean }>(
    `INSERT INTO codes (
       ai01_gtin, ai21_serial, ai93_tail, raw, raw_hash, base_hash, product_id, pool_id
     )
     SELECT u.gtin, u.serial, u.ai93, u.raw, u.raw_hash::bigint, u.base_hash::bigint, u.product_id, u.pool_id
     FROM unnest(
       $1::char(14)[],
       $2::text[],
       $3::bytea[],
       $4::bytea[],
       $5::text[],
       $6::text[],
       $7::int[],
       $8::bigint[]
     ) AS u(gtin, serial, ai93, raw, raw_hash, base_hash, product_id, pool_id)
     ON CONFLICT (raw_hash) DO UPDATE SET
       base_hash = COALESCE(codes.base_hash, EXCLUDED.base_hash),
       product_id = COALESCE(codes.product_id, EXCLUDED.product_id),
       pool_id = COALESCE(codes.pool_id, EXCLUDED.pool_id)
     RETURNING code_id::text, raw_hash::text, (xmax = 0) AS inserted`,
    [gtins, serials, ai93s, raws, rawHashes, baseHashes, productIds, poolIds]
  )
  return r.rows
}

async function batchUpsertCodeState(client: PoolClient, siteId: number, codeIds: string[]) {
  if (codeIds.length === 0) return
  await client.query(
    `INSERT INTO code_state (code_id, site_id, status_id, introduced_at, updated_at)
     SELECT unnest($1::bigint[]), $2, 5, now(), now()
     ON CONFLICT (code_id) DO UPDATE SET
       site_id = EXCLUDED.site_id,
       status_id = GREATEST(code_state.status_id, EXCLUDED.status_id),
       introduced_at = COALESCE(code_state.introduced_at, EXCLUDED.introduced_at),
       updated_at = now()`,
    [codeIds, siteId]
  )
}

async function batchUpsertItemCodes(
  client: PoolClient,
  siteId: number,
  rows: Array<{ codeId: string; itemId: string; locationId: string | null; packLevel: string }>
) {
  if (rows.length === 0) return
  const codeIds = rows.map((r) => r.codeId)
  const itemIds = rows.map((r) => r.itemId)
  const locationIds = rows.map((r) => r.locationId)
  const packLevels = rows.map((r) => r.packLevel)

  await client.query(
    `INSERT INTO wms_item_codes (item_id, code_id, current_site_id, current_location_id, pack_level, linked_at)
     SELECT u.item_id, u.code_id, $2, u.location_id, u.pack_level, now()
     FROM unnest($1::bigint[], $3::bigint[], $4::bigint[], $5::text[]) AS u(code_id, item_id, location_id, pack_level)
     ON CONFLICT (code_id) DO UPDATE SET
       item_id = EXCLUDED.item_id,
       current_site_id = EXCLUDED.current_site_id,
       current_location_id = COALESCE(EXCLUDED.current_location_id, wms_item_codes.current_location_id),
       pack_level = COALESCE(EXCLUDED.pack_level, wms_item_codes.pack_level),
       unlinked_at = NULL,
       linked_at = COALESCE(wms_item_codes.linked_at, now())`,
    [codeIds, siteId, itemIds, locationIds, packLevels]
  )
}

async function batchUpdateParents(
  client: PoolClient,
  updates: Array<{ codeId: string; parentCodeId: string }>
) {
  if (updates.length === 0) return
  for (const chunk of chunkArray(updates, IMPORT_CHUNK)) {
    await client.query(
      `UPDATE codes c
       SET parent_code_id = v.parent_id::bigint
       FROM unnest($1::bigint[], $2::bigint[]) AS v(code_id, parent_id)
       WHERE c.code_id = v.code_id`,
      [chunk.map((u) => u.codeId), chunk.map((u) => u.parentCodeId)]
    )
  }
}

async function upsertMarkingCodeRow(
  client: PoolClient,
  args: {
    gtin: string
    serial: string
    ai93: Buffer | null
    raw: Buffer
    rawHash: string
    baseHash: string
    productId: number
    parentCodeId: string | null
    poolId: number | null
  }
): Promise<{ codeId: string; inserted: boolean }> {
  const existing = await client.query<{ code_id: string; raw_hash: string }>(
    `SELECT code_id::text AS code_id, raw_hash::text AS raw_hash
     FROM codes
     WHERE raw_hash = $1::bigint
        OR base_hash = $2::bigint
        OR (ai01_gtin = $3 AND ai21_serial = $4)
     ORDER BY
       CASE
         WHEN raw_hash = $1::bigint THEN 0
         WHEN base_hash = $2::bigint THEN 1
         ELSE 2
       END
     LIMIT 1`,
    [args.rawHash, args.baseHash, args.gtin, args.serial]
  )

  if (existing.rows[0]) {
    const codeId = existing.rows[0].code_id
    await client.query(
      `UPDATE codes SET
         base_hash = COALESCE(base_hash, $2::bigint),
         product_id = COALESCE(product_id, $3),
         parent_code_id = COALESCE($4::bigint, parent_code_id),
         pool_id = COALESCE($5::bigint, pool_id),
         raw = COALESCE(raw, $6),
         ai93_tail = COALESCE(ai93_tail, $7)
       WHERE code_id = $1::bigint`,
      [codeId, args.baseHash, args.productId, args.parentCodeId, args.poolId, args.raw, args.ai93]
    )
    return { codeId, inserted: false }
  }

  const ins = await client.query<{ code_id: string }>(
    `INSERT INTO codes (
       ai01_gtin, ai21_serial, ai93_tail, raw, raw_hash, base_hash, product_id,
       parent_code_id, pool_id
     ) VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint, $7, $8::bigint, $9::bigint)
     RETURNING code_id::text AS code_id`,
    [
      args.gtin,
      args.serial,
      args.ai93,
      args.raw,
      args.rawHash,
      args.baseHash,
      args.productId,
      args.parentCodeId,
      args.poolId,
    ]
  )
  return { codeId: ins.rows[0]!.code_id, inserted: true }
}

export async function importNestMarkingCodes(
  client: PoolClient,
  siteId: number,
  codes: ParsedMarkingCode[],
  options: {
    poolId?: number | null
    locationId?: string | null
    createMissingItems?: boolean
    batchLabel?: string
    productItemCode?: string
    productName?: string
    productGtin?: string
    productionLineCode?: string
    relinkStubs?: boolean
  }
): Promise<NestImportResult & { productItemId?: string; relinked?: number }> {
  const result: NestImportResult = {
    inserted: 0,
    existing: 0,
    linked: 0,
    itemsCreated: 0,
    stockAdjusted: 0,
    errors: [],
  }

  let poolId = options.poolId ?? null
  if (poolId == null && options.batchLabel?.trim()) {
    const pool = await client.query<{ pool_id: string }>(
      `INSERT INTO marking_pools (site_id, batch_label)
       VALUES ($1, $2)
       ON CONFLICT (site_id, batch_label) DO UPDATE SET batch_label = EXCLUDED.batch_label
       RETURNING pool_id::text AS pool_id`,
      [siteId, options.batchLabel.trim()]
    )
    poolId = Number(pool.rows[0]!.pool_id)
  }

  const sorted = [...codes].sort((a, b) => {
    const rank = (l: MarkingPackLevel) => (l === "pallet" ? 0 : l === "block" ? 1 : 2)
    return rank(a.level) - rank(b.level)
  })

  const packaging = inferPackagingGtinsFromCodes(sorted)
  const sampleUnitGtin = packaging.unitGtin ?? sorted.find((c) => c.level === "unit")?.gtin

  const product = await resolveFinishedGoodsProductItem(client, siteId, {
    productItemCode: options.productItemCode,
    productName: options.productName,
    productGtin: options.productGtin,
    packaging,
    sampleUnitGtin,
    createMissing: options.createMissingItems !== false,
  })

  if (!product) {
    result.errors.push("Не найдена номенклатура продукта (finished_goods). Укажите код номенклатуры или создайте карточку «сливы».")
    return result
  }

  if (product.created) result.itemsCreated += 1

  const lineCode = options.productionLineCode?.trim().toUpperCase() || ""
  if (lineCode) {
    const line = await client.query<{ display_name: string }>(
      `SELECT display_name FROM wms_production_line_defs
       WHERE site_id = $1 AND UPPER(line_code) = $2 AND is_active
       LIMIT 1`,
      [siteId, lineCode]
    )
    const lineName = line.rows[0]?.display_name || lineCode
    await client.query(
      `UPDATE wms_items
       SET line_group = $2,
           item_attrs_json = COALESCE(item_attrs_json, '{}'::jsonb) || $3::jsonb,
           updated_at = now()
       WHERE item_id = $1::bigint`,
      [
        product.itemId,
        lineCode,
        JSON.stringify({ productionLine: { code: lineCode, name: lineName } }),
      ]
    )
  }

  const uniqueGtins = [...new Set(sorted.map((c) => c.gtin))]
  const productByGtin = await ensureMarkingProducts(client, uniqueGtins)

  const existingMaps = await preloadExistingCodes(client, sorted)
  const codeIdByRawHash = new Map<string, string>()
  const codeIdByIdentification = new Map<string, string>()

  for (const chunk of chunkArray(sorted, IMPORT_CHUNK)) {
    const toInsert: ParsedMarkingCode[] = []

    for (const code of chunk) {
      const existingId = resolveExistingCodeId(code, existingMaps)
      if (existingId) {
        codeIdByRawHash.set(code.rawHash, existingId)
        registerCodeAliases(code, existingId, codeIdByIdentification)
        result.existing += 1
        continue
      }
      toInsert.push(code)
    }

    if (toInsert.length === 0) continue

    try {
      const inserted = await batchInsertCodes(client, toInsert, productByGtin, poolId)
      const byRawReturned = new Map(inserted.map((r) => [r.raw_hash, r]))

      for (const code of toInsert) {
        const row = byRawReturned.get(code.rawHash)
        if (!row) {
          const fallbackId = resolveExistingCodeId(code, existingMaps)
          if (fallbackId) {
            codeIdByRawHash.set(code.rawHash, fallbackId)
            registerCodeAliases(code, fallbackId, codeIdByIdentification)
            result.existing += 1
          } else {
            result.errors.push(`${formatMarkingCodeDisplay(code.identificationCode)}: не удалось сохранить`)
          }
          continue
        }
        codeIdByRawHash.set(code.rawHash, row.code_id)
        existingMaps.byRaw.set(code.rawHash, row.code_id)
        existingMaps.byBase.set(code.baseHash, row.code_id)
        existingMaps.byGtinSerial.set(`${code.gtin}\0${code.serial}`, row.code_id)
        registerCodeAliases(code, row.code_id, codeIdByIdentification)
        if (row.inserted) result.inserted += 1
        else result.existing += 1
      }
    } catch (e) {
      for (const code of toInsert) {
        try {
          const productId = productByGtin.get(code.gtin)!
          const up = await upsertMarkingCodeRow(client, {
            gtin: code.gtin,
            serial: code.serial,
            ai93: code.ai93,
            raw: code.raw,
            rawHash: code.rawHash,
            baseHash: code.baseHash,
            productId,
            parentCodeId: null,
            poolId,
          })
          codeIdByRawHash.set(code.rawHash, up.codeId)
          registerCodeAliases(code, up.codeId, codeIdByIdentification)
          if (up.inserted) result.inserted += 1
          else result.existing += 1
        } catch (oneErr) {
          const msg = oneErr instanceof Error ? oneErr.message : String(oneErr)
          result.errors.push(`${formatMarkingCodeDisplay(code.identificationCode)}: ${msg}`)
        }
      }
    }
  }

  const parentUpdates: Array<{ codeId: string; parentCodeId: string }> = []
  for (const code of sorted) {
    if (!code.parentCode) continue
    const codeId = codeIdByRawHash.get(code.rawHash)
    const parentCodeId = codeIdByIdentification.get(code.parentCode)
    if (codeId && parentCodeId) parentUpdates.push({ codeId, parentCodeId })
  }
  await batchUpdateParents(client, parentUpdates)

  const itemCodeRows: Array<{
    codeId: string
    itemId: string
    locationId: string | null
    packLevel: string
  }> = []
  for (const code of sorted) {
    const codeId = codeIdByRawHash.get(code.rawHash)
    if (!codeId) continue
    itemCodeRows.push({
      codeId,
      itemId: product.itemId,
      locationId: options.locationId ?? null,
      packLevel: code.level === "unit" ? "unit" : code.level,
    })
  }

  const allCodeIds = itemCodeRows.map((r) => r.codeId)
  for (const chunk of chunkArray(allCodeIds, IMPORT_CHUNK)) {
    await batchUpsertCodeState(client, siteId, chunk)
  }
  for (const chunk of chunkArray(itemCodeRows, IMPORT_CHUNK)) {
    await batchUpsertItemCodes(client, siteId, chunk)
  }
  result.linked = itemCodeRows.length

  if (options.locationId) {
    const stockByItem = new Map<string, number>()
    for (const row of itemCodeRows) {
      if (row.packLevel !== "unit") continue
      stockByItem.set(row.itemId, (stockByItem.get(row.itemId) ?? 0) + 1)
    }
    for (const [itemId, qty] of stockByItem) {
      await client.query(
        `INSERT INTO wms_stock_balances (site_id, location_id, item_id, available_qty, updated_at)
         VALUES ($1, $2::bigint, $3::bigint, $4, now())
         ON CONFLICT (site_id, location_id, item_id)
         DO UPDATE SET available_qty = wms_stock_balances.available_qty + EXCLUDED.available_qty, updated_at = now()`,
        [siteId, options.locationId, itemId, qty]
      )
      result.stockAdjusted += qty
    }
  }

  let relinked = 0
  if (options.relinkStubs !== false) {
    const rel = await relinkStubMarkingCodesToProduct(client, siteId, product.itemId, {
      ...packaging,
      ...product.packaging,
    })
    relinked = rel.relinked
  }

  return { ...result, productItemId: product.itemId, relinked }
}

/** Нормализованный ключ для dedup при ручном вводе. */
export function normalizeNestIdentificationCode(code: string): string {
  const sscc = parseSscc(code.trim())
  if (sscc) return code.trim()
  return normalizeCrptCode(code)
}
