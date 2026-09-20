import type { PoolClient } from "pg"
import {
  listPlacementPallets,
  pickAccessibleLpns,
  resolveAllRowSettings,
} from "@/lib/wms/fg-placement"
import { canonicalPlanRowId } from "@/lib/wms/fg-plan-location-codes"
import type { EffectiveRowSettings, PlacementPallet } from "@/lib/wms/fg-placement-types"

const SHIP_TASK_TYPES = new Set([
  "interwarehouse_transfer",
  "internal_transfer",
  "transfer",
  "pick",
  "ship",
  "shipment",
])

export type FgPickPlanCode = {
  code: string
  kind: "pallet" | "block" | "unit"
}

export type FgPickPlanPallet = {
  pickOrder: number
  palletId: string
  lpn: string
  palletCode: string
  position: number
  stackRole: "face" | "blocked"
  stackLabel: string
  blockedBy: string[]
  planRowId: string
  zone: string
  locationCode: string
  itemCode: string
  itemName: string
  bottles: number
  blocks: number
  manufacturedAt: string | null
  expiryAt: string | null
  codes: FgPickPlanCode[]
}

export type FgPickPlanSuggested = {
  planRowId: string
  zone: string
  locationCode: string
  rowLabel: string
  allocationStrategy: string
}

export type FgPickPlan = {
  enough: boolean
  plannedQty: number
  totalAvailable: number
  shortage: number
  dateFilter: string | null
  reason: string | null
  suggested: FgPickPlanSuggested | null
  availableDates: string[]
  pallets: FgPickPlanPallet[]
}

export function isFgShipTaskType(taskType: string | null | undefined): boolean {
  return SHIP_TASK_TYPES.has(String(taskType || "").trim().toLowerCase())
}

export function calendarDay(value: string | null | undefined, timeZone = "Europe/Moscow"): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  const odata = raw.match(/^\/Date\((\d+)\)\/$/)
  const iso = odata ? new Date(Number(odata[1])).toISOString() : raw
  const ymd = iso.match(/^(\d{4}-\d{2}-\d{2})/)
  if (ymd && Number.isNaN(Date.parse(iso))) return ymd[1]
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ymd?.[1] ?? null
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function collectDateCandidates(value: unknown, into: unknown[], depth = 0) {
  if (value == null || depth > 4) return
  if (typeof value === "string" || typeof value === "number") {
    into.push(value)
    return
  }
  const rec = asRecord(value)
  if (!rec) return
  for (const [key, v] of Object.entries(rec)) {
    if (/датапроизводства|датарозлива|manufactured|productiondate|emission|розлив|emitted/i.test(key)) {
      collectDateCandidates(v, into, depth + 1)
    } else if (depth < 2 && (key === "erpLine" || key === "selectedLot" || key === "erpTransfer")) {
      collectDateCandidates(v, into, depth + 1)
    }
  }
}

export function extractRequestedManufactureDay(
  payload: unknown,
  lotManufacturedAt?: string | null
): string | null {
  const rec = asRecord(payload) ?? {}
  const selected = asRecord(rec.selectedLot)
  const candidates: unknown[] = [
    lotManufacturedAt,
    selected?.manufacturedAt,
    rec.manufacturedAt,
  ]
  collectDateCandidates(rec, candidates)
  for (const c of candidates) {
    const day = typeof c === "number" ? calendarDay(new Date(c).toISOString()) : calendarDay(String(c ?? ""))
    if (day) return day
  }
  return null
}

export function formatPlanRowLabel(planRowId: string, zone: string): string {
  const id = canonicalPlanRowId(planRowId) || planRowId
  const m = id.match(/^([A-ZА-ЯЁ]+)-(\d+)$/i)
  const z = (zone || m?.[1] || "").toUpperCase()
  const n = m?.[2] || ""
  if (n && z) return `ряд ${Number(n)} · зона ${z}`
  return id || "ряд не найден"
}

function formatMarkingCode(gtin: string, serial: string, raw: string | null): string {
  const compactRaw = (raw || "").replace(/\s+/g, "").trim()
  if (compactRaw.length >= 14 && /01|00|\(01\)|\(00\)/.test(compactRaw)) return compactRaw
  const g = (gtin || "").trim()
  const s = (serial || "").trim()
  if (g.startsWith("00") && g.length >= 18) return `(00)${g}`
  if (g && s) return `(01)${g}(21)${s}`
  return `${g}${s}`
}

function palletMatchesItem(pallet: PlacementPallet, itemCode: string): boolean {
  const want = itemCode.trim().toLowerCase()
  if (!want) return false
  return (
    pallet.itemCode.trim().toLowerCase() === want ||
    pallet.sku.trim().toLowerCase() === want
  )
}

const NAME_STOP = new Set([
  "напиток",
  "безалкогольный",
  "сильногазированный",
  "среднегазированный",
  "монастырские",
  "вкусом",
  "натуральный",
  "газированная",
  "негазированная",
])

function distinctiveNameNeedle(name: string): string {
  const cleaned = name.replace(/^я/i, " ").toLocaleLowerCase("ru")
  const tokens = cleaned
    .split(/[^a-zа-яё]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !NAME_STOP.has(t) && !/^\d+$/.test(t))
  return tokens[0] || ""
}

function palletMatchesTask(
  pallet: PlacementPallet,
  codes: Set<string>,
  nameNeedle: string
): boolean {
  if (
    [pallet.itemCode, pallet.sku, pallet.palletCode, pallet.lpn].some((v) =>
      codes.has(String(v || "").trim().toLowerCase())
    )
  ) {
    return true
  }
  if (nameNeedle && pallet.itemName.toLocaleLowerCase("ru").includes(nameNeedle)) return true
  return false
}

function palletMatchesDay(pallet: PlacementPallet, day: string | null): boolean {
  if (!day) return true
  return calendarDay(pallet.manufacturedAt) === day || calendarDay(pallet.receivedAt) === day
}

async function loadPalletCounts(
  client: PoolClient,
  palletIds: string[]
): Promise<Map<string, { bottles: number; blocks: number }>> {
  const ids = palletIds.filter((id) => /^\d+$/.test(id))
  const map = new Map<string, { bottles: number; blocks: number }>()
  if (ids.length === 0) return map
  const r = await client.query<{ palletId: string; bottles: string; blocks: string }>(
    `
    SELECT
      pal.pallet_id::text AS "palletId",
      (
        SELECT COUNT(*)::text
        FROM codes u
        JOIN codes b ON b.code_id = u.parent_code_id
        WHERE b.parent_code_id = pal.pallet_id
      ) AS bottles,
      (
        SELECT COUNT(*)::text FROM codes b WHERE b.parent_code_id = pal.pallet_id
      ) AS blocks
    FROM unnest($1::bigint[]) AS pal(pallet_id)
    `,
    [ids]
  )
  for (const row of r.rows) {
    map.set(row.palletId, {
      bottles: Number(row.bottles) || 0,
      blocks: Number(row.blocks) || 0,
    })
  }
  return map
}

async function loadPalletCodes(
  client: PoolClient,
  palletIds: string[]
): Promise<Map<string, FgPickPlanCode[]>> {
  const ids = palletIds.filter((id) => /^\d+$/.test(id)).slice(0, 24)
  const map = new Map<string, FgPickPlanCode[]>()
  if (ids.length === 0) return map
  const r = await client.query<{
    codeId: string
    parentId: string | null
    gtin: string
    serial: string
    packLevel: string | null
    raw: string | null
  }>(
    `
    SELECT
      c.code_id::text AS "codeId",
      c.parent_code_id::text AS "parentId",
      c.ai01_gtin AS gtin,
      COALESCE(c.ai21_serial, '') AS serial,
      COALESCE(mic.pack_level, '') AS "packLevel",
      encode(c.raw, 'escape') AS raw
    FROM codes c
    LEFT JOIN wms_item_codes mic ON mic.code_id = c.code_id AND mic.unlinked_at IS NULL
    WHERE c.code_id = ANY($1::bigint[])
       OR c.parent_code_id = ANY($1::bigint[])
    ORDER BY c.code_id
    `,
    [ids]
  )
  const palletSet = new Set(ids)
  for (const row of r.rows) {
    const owner = palletSet.has(row.codeId) ? row.codeId : row.parentId
    if (!owner || !palletSet.has(owner)) continue
    const isPallet = palletSet.has(row.codeId)
    const kind: FgPickPlanCode["kind"] = isPallet || row.gtin?.startsWith("00") || row.packLevel === "pallet"
      ? "pallet"
      : row.packLevel === "block" || (!isPallet && row.parentId && palletSet.has(row.parentId))
        ? "block"
        : "unit"
    if (kind === "unit") continue
    const list = map.get(owner) ?? []
    list.push({
      code: formatMarkingCode(row.gtin, row.serial, row.raw),
      kind,
    })
    map.set(owner, list)
  }
  for (const [id, list] of map) {
    list.sort((a, b) => {
      const rank = (k: FgPickPlanCode["kind"]) => (k === "pallet" ? 0 : k === "block" ? 1 : 2)
      const d = rank(a.kind) - rank(b.kind)
      return d !== 0 ? d : a.code.localeCompare(b.code)
    })
    map.set(id, list)
  }
  return map
}

async function loadStockQty(client: PoolClient, siteId: number, itemCode: string): Promise<number> {
  const r = await client.query<{ qty: string }>(
    `
    SELECT COALESCE(SUM(sb.available_qty), 0)::text AS qty
    FROM wms_stock_balances sb
    JOIN wms_items i ON i.item_id = sb.item_id
    JOIN wms_locations l ON l.location_id = sb.location_id
    JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
    WHERE sb.site_id = $1
      AND i.item_code = $2
      AND (
        w.warehouse_code ILIKE 'FG%'
        OR COALESCE(w.warehouse_type, '') ILIKE '%FINISH%'
        OR COALESCE(w.name, '') ILIKE '%готов%'
      )
    `,
    [siteId, itemCode]
  )
  return Number(r.rows[0]?.qty ?? 0) || 0
}

function rowSettingsMap(settings: EffectiveRowSettings[]) {
  const byRow = new Map<string, EffectiveRowSettings>()
  for (const s of settings) {
    byRow.set(s.planRowId, s)
    byRow.set(canonicalPlanRowId(s.planRowId), s)
    byRow.set(s.locationId, s)
  }
  return byRow
}

export async function buildFgPickPlanForTask(
  client: PoolClient,
  siteId: number,
  input: {
    itemCode: string | null | undefined
    plannedQty: number
    payload?: unknown
    manufacturedAt?: string | null
    taskType?: string | null
  }
): Promise<FgPickPlan | null> {
  const itemCode = String(input.itemCode || "").trim()
  if (!itemCode) return null
  if (input.taskType && !isFgShipTaskType(input.taskType)) return null

  const item = await client.query<{
    item_id: string
    item_type_code: string | null
    name: string | null
    sku: string | null
    gtin: string | null
  }>(
    `SELECT item_id::text AS item_id, item_type_code, name, sku,
            COALESCE(item_attrs_json->'nomenclature'->>'gtin', sku) AS gtin
     FROM wms_items WHERE site_id = $1 AND item_code = $2 LIMIT 1`,
    [siteId, itemCode]
  )
  const itemType = String(item.rows[0]?.item_type_code || "").toLowerCase()
  if (["materials", "stickers", "packaging", "equipment"].includes(itemType)) {
    return null
  }
  const itemName = String(item.rows[0]?.name || "")
  let extraCodes = new Set(
    [itemCode, item.rows[0]?.sku, item.rows[0]?.gtin]
      .map((v) => String(v || "").trim().toLowerCase())
      .filter(Boolean)
  )
  for (const code of [...extraCodes]) {
    if (/^\d{13,14}$/.test(code)) extraCodes.add(code.padStart(14, "0"))
  }
  if (item.rows[0]?.item_id) {
    try {
      const aliasRows = await client.query<{ gtin: string | null; alias_sku: string | null }>(
        `SELECT gtin, alias_sku FROM wms_item_aliases
         WHERE item_id = $1::bigint AND COALESCE(is_active, TRUE)`,
        [item.rows[0].item_id]
      )
      for (const a of aliasRows.rows) {
        for (const v of [a.gtin, a.alias_sku]) {
          const s = String(v || "").trim().toLowerCase()
          if (s) extraCodes.add(s)
        }
      }
    } catch {
      /* aliases table may differ between environments */
    }
  }
  const nameNeedle = distinctiveNameNeedle(itemName)

  const plannedQty = Number(input.plannedQty) || 0
  const dateFilter = extractRequestedManufactureDay(input.payload, input.manufacturedAt)
  const [settings, pallets] = await Promise.all([
    resolveAllRowSettings(client, siteId),
    listPlacementPallets(client, siteId),
  ])
  const byRow = rowSettingsMap(settings)
  const pool = pallets
  const skuPallets = pool.filter((p) => !p.blocked && palletMatchesTask(p, extraCodes, nameNeedle))
  const availableDates = [
    ...new Set(
      skuPallets
        .map((p) => calendarDay(p.manufacturedAt) || calendarDay(p.receivedAt))
        .filter((d): d is string => Boolean(d))
    ),
  ].sort()
  const matching = skuPallets.filter((p) => palletMatchesDay(p, dateFilter))

  const counts = await loadPalletCounts(
    client,
    matching.map((p) => p.palletId)
  )
  const codesByPallet = await loadPalletCodes(
    client,
    matching.map((p) => p.palletId)
  )

  const groups = new Map<string, PlacementPallet[]>()
  for (const p of matching) {
    const key = canonicalPlanRowId(p.planRowId) || p.planRowId || p.locationCode
    const list = groups.get(key) ?? []
    list.push(p)
    groups.set(key, list)
  }

  type Ranked = {
    key: string
    zone: string
    locationCode: string
    planRowId: string
    strategy: string
    faceIsSku: boolean
    faceExpiry: number
    bottles: number
    rows: FgPickPlanPallet[]
  }
  const ranked: Ranked[] = []

  for (const [key, group] of groups) {
    const sample = group[0]
    const planRowId = canonicalPlanRowId(sample.planRowId) || sample.planRowId
    const row = byRow.get(planRowId) || byRow.get(sample.planRowId) || byRow.get(sample.locationId)
    const mates = pool.filter(
      (p) => (canonicalPlanRowId(p.planRowId) || p.planRowId) === planRowId && !p.blocked
    )
    const access = pickAccessibleLpns(
      mates.map((p) => ({ lpn: p.lpn, position: p.position })),
      row?.capacity ?? Math.max(24, mates.length),
      row?.storageStrategy ?? "fifo_lane",
      row?.pickSide ?? "start"
    )
    const order = [...group].sort((a, b) => {
      const aFace = access.accessible.includes(a.lpn) ? 0 : 1
      const bFace = access.accessible.includes(b.lpn) ? 0 : 1
      if (aFace !== bFace) return aFace - bFace
      return a.position - b.position
    })
    const rows: FgPickPlanPallet[] = order.map((p) => {
      const qty = counts.get(p.palletId) ?? { bottles: 0, blocks: 0 }
      const bottles = qty.bottles > 0 ? qty.bottles : Number(p.unitQty) || 0
      const blockedBy = access.blockedBy[p.lpn] ?? []
      const face = access.accessible.includes(p.lpn)
      const codes = codesByPallet.get(p.palletId) ?? []
      if (codes.length === 0 && (p.lpn || p.palletCode)) {
        codes.push({ code: p.lpn || p.palletCode, kind: "pallet" })
      }
      return {
        pickOrder: 0,
        palletId: p.palletId,
        lpn: p.lpn,
        palletCode: p.palletCode,
        position: p.position,
        stackRole: face ? "face" : "blocked",
        stackLabel: face
          ? "снизу — берите первой"
          : blockedBy.length > 0
            ? `сверху — за палетой ${blockedBy[0]}`
            : "сверху",
        blockedBy,
        planRowId,
        zone: p.zone || planRowId.split("-")[0] || "",
        locationCode: p.locationCode,
        itemCode: p.itemCode,
        itemName: p.itemName,
        bottles,
        blocks: qty.blocks,
        manufacturedAt: p.manufacturedAt,
        expiryAt: p.expiryAt,
        codes,
      }
    })
    const bottles = rows.reduce((sum, p) => sum + p.bottles, 0)
    ranked.push({
      key,
      zone: sample.zone || planRowId.split("-")[0] || "",
      locationCode: sample.locationCode,
      planRowId,
      strategy: row?.allocationStrategy ?? "fefo",
      faceIsSku: Boolean(access.accessible[0] && order.some((p) => p.lpn === access.accessible[0])),
      faceExpiry: Date.parse(order[0]?.expiryAt || "") || Number.POSITIVE_INFINITY,
      bottles,
      rows,
    })
  }

  ranked.sort((a, b) => {
    if (a.faceIsSku !== b.faceIsSku) return a.faceIsSku ? -1 : 1
    if (a.bottles !== b.bottles) return b.bottles - a.bottles
    if (a.faceExpiry !== b.faceExpiry) return a.faceExpiry - b.faceExpiry
    return a.planRowId.localeCompare(b.planRowId)
  })

  const orderedPallets: FgPickPlanPallet[] = []
  for (const g of ranked) {
    for (const p of g.rows) {
      orderedPallets.push({ ...p, pickOrder: orderedPallets.length + 1 })
    }
  }

  const markingQty = orderedPallets.reduce((sum, p) => sum + p.bottles, 0)
  const stockQty = dateFilter ? 0 : await loadStockQty(client, siteId, itemCode)
  const totalAvailable = Math.max(markingQty, stockQty)
  const enough = plannedQty <= 0 ? totalAvailable > 0 : totalAvailable + 1e-9 >= plannedQty
  const suggested = ranked[0]
    ? {
        planRowId: ranked[0].planRowId,
        zone: ranked[0].zone,
        locationCode: ranked[0].locationCode,
        rowLabel: formatPlanRowLabel(ranked[0].planRowId, ranked[0].zone),
        allocationStrategy: ranked[0].strategy,
      }
    : null

  let reason: string | null = null
  if (!enough) {
    if (matching.length === 0 && skuPallets.length > 0 && dateFilter) {
      const dates = availableDates
        .map((d) => d.split("-").reverse().join("."))
        .join(", ")
      reason = `На складе ГП нет этой даты. Есть: ${dates || "другие даты"}`
    } else if (matching.length === 0) {
      reason = "Этого товара нет на складе готовой продукции"
    } else {
      reason = `На складе ${totalAvailable} шт, нужно ${plannedQty}`
    }
  }

  return {
    enough,
    plannedQty,
    totalAvailable,
    shortage: enough ? 0 : Math.max(0, plannedQty - totalAvailable),
    dateFilter,
    reason,
    suggested,
    availableDates,
    pallets: orderedPallets,
  }
}

export async function scanBelongsToFgPickPlan(
  client: PoolClient,
  siteId: number,
  rawCode: string,
  plan: FgPickPlan
): Promise<{ ok: true } | { ok: false; message: string }> {
  const code = rawCode.trim().replace(/\s+/g, "")
  if (!code) return { ok: false, message: "Пустой код" }
  if (plan.pallets.length === 0) {
    return { ok: false, message: plan.reason || "Нет палет для отбора" }
  }

  const allowedLpns = new Set(plan.pallets.flatMap((p) => [p.lpn, p.palletCode, p.palletId].filter(Boolean)))
  const allowedLocations = new Set(plan.pallets.map((p) => p.locationCode).filter(Boolean))
  const allowedCodes = new Set(plan.pallets.flatMap((p) => p.codes.map((c) => c.code.replace(/\s+/g, ""))))
  if (allowedLpns.has(code) || allowedCodes.has(code)) return { ok: true }

  const q = code.replace(/[()]/g, "")
  const r = await client.query<{
    palletId: string | null
    locationCode: string | null
    itemCode: string | null
    lpn: string | null
  }>(
    `
    SELECT
      COALESCE(
        CASE WHEN c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet' THEN c.code_id END,
        CASE WHEN p1.ai01_gtin LIKE '00%' THEN p1.code_id END,
        CASE WHEN p2.ai01_gtin LIKE '00%' THEN p2.code_id END
      )::text AS "palletId",
      l.location_code AS "locationCode",
      i.item_code AS "itemCode",
      COALESCE(NULLIF(pc.ai21_serial, ''), pc.ai01_gtin || COALESCE(pc.ai21_serial, '')) AS lpn
    FROM codes c
    LEFT JOIN codes p1 ON p1.code_id = c.parent_code_id
    LEFT JOIN codes p2 ON p2.code_id = p1.parent_code_id
    LEFT JOIN wms_item_codes mic ON mic.code_id = c.code_id AND mic.unlinked_at IS NULL
    LEFT JOIN wms_items i ON i.item_id = mic.item_id
    LEFT JOIN wms_locations l ON l.location_id = mic.current_location_id
    LEFT JOIN codes pc ON pc.code_id = COALESCE(
      CASE WHEN c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet' THEN c.code_id END,
      CASE WHEN p1.ai01_gtin LIKE '00%' THEN p1.code_id END,
      CASE WHEN p2.ai01_gtin LIKE '00%' THEN p2.code_id END
    )
    WHERE (mic.current_site_id = $1 OR mic.code_id IS NULL)
      AND (
        c.ai21_serial = $2
        OR c.ai01_gtin = $2
        OR c.ai01_gtin || COALESCE(c.ai21_serial, '') = $2
        OR replace(encode(c.raw, 'escape'), ' ', '') ILIKE '%' || $2 || '%'
        OR replace(encode(c.raw, 'escape'), ' ', '') ILIKE '%' || $3 || '%'
      )
    ORDER BY mic.linked_at DESC NULLS LAST
    LIMIT 1
    `,
    [siteId, code, q]
  )
  const hit = r.rows[0]
  if (!hit) {
    return { ok: false, message: "Код не найден среди палет этого задания" }
  }
  if (hit.palletId && allowedLpns.has(hit.palletId)) return { ok: true }
  if (hit.lpn && allowedLpns.has(hit.lpn)) return { ok: true }
  if (hit.locationCode && allowedLocations.has(hit.locationCode)) return { ok: true }
  const want = plan.suggested?.rowLabel || plan.suggested?.planRowId || "указанного ряда"
  return {
    ok: false,
    message: `Этот код не с ${want}. Возьмите палету снизу по списку кодов`,
  }
}

export async function defaultWarehouseLocationCode(
  client: PoolClient,
  siteId: number,
  warehouseId: string | null | undefined
): Promise<string | null> {
  if (!warehouseId) return null
  const r = await client.query<{ location_code: string }>(
    `SELECT location_code
     FROM wms_locations
     WHERE site_id = $1 AND warehouse_id = $2::bigint
     ORDER BY CASE
       WHEN location_code ILIKE '%-IN' THEN 0
       WHEN location_code ILIKE '%INB%' THEN 1
       ELSE 2
     END, location_code
     LIMIT 1`,
    [siteId, warehouseId]
  )
  return r.rows[0]?.location_code ?? null
}
