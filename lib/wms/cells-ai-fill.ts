import { randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import { saveRowDraft } from "@/lib/wms/fg-placement"
import { ensureFgPlacementSchema } from "@/lib/wms/fg-placement-schema"
import type { AllocationStrategy, LaneSide, RowPlacementDraft, StorageStrategy } from "@/lib/wms/fg-placement-types"
import { extractJsonObject, llmChat, llmGatewayConfigured } from "@/lib/wms/llm-gateway"
import { getSiteId } from "@/lib/wms/resolve"

export type CellsAiLogLine = {
  locationCode: string
  warehouseCode: string
  zoneCode: string
  materialType: string | null
  processType: string | null
  title: string | null
  lane: string | null
  action: "filled" | "preview" | "skipped" | "error"
  note: string
}

export type CellsAiJob = {
  id: string
  status: "running" | "stopping" | "stopped" | "done" | "error"
  apply: boolean
  limit: number
  total: number
  processed: number
  filled: number
  skipped: number
  error: string | null
  log: CellsAiLogLine[]
  startedAt: string
  finishedAt: string | null
  abort: AbortController
}

const jobs = new Map<string, CellsAiJob>()
const BATCH = 8
export const CELLS_AI_MAX_LIMIT = 700
const MAX_LOG = 80
const FG_CLASS = { kind: "class" as const, value: "F", label: "Готовая продукция" }

const MATERIAL = new Set(["ST", "LB", "PK", "CP", "PL", "ANY"])
const PROCESS = new Set([
  "SER",
  "BAGG",
  "CAGG",
  "PAGG",
  "PACK-WATER",
  "DRINK",
  "STORE",
  "RECV",
  "QUARANTINE",
  "DEFECT",
  "WRITEOFF",
  "ANY",
])
const SHAPE = new Set(["RND", "SQR", "RECT", "ANY"])
const PRODUCT = new Set(["SLNG", "SLGZ", "DSLV", "SLKR", "DRNK", "PWTR", "ANY"])
const VOLUME = new Set(["05", "10", "15", "50", "190", "ANY"])
const PLACE = new Set(["CAP", "BTL", "BLOCK", "BOX", "PALLET", "ANY"])
const EQUIP = new Set(["APPLICATOR", "NOVEXX", "APPLICATOR-NOVEXX", "ANY"])
const RECV_CAT = new Set(["stickers", "water", "MaterialsFactory"])

type CellRow = {
  locationId: string
  locationCode: string
  displayName: string | null
  warehouseCode: string
  zoneCode: string
  zoneName: string | null
  locationAttrs: unknown
  placementStrategy: string | null
  qty: number
  occupiedCode: string | null
  occupiedName: string | null
}

type FgLanePolicy = {
  storageStrategy: StorageStrategy
  allocationStrategy: AllocationStrategy
  loadSide: LaneSide
  pickSide: LaneSide
  label: string
  reason: string
}

type LlmCellSuggestion = {
  locationCode: string
  materialType: string | null
  processType: string | null
  stickerShape: string | null
  productGroup: string | null
  volume: string | null
  applicationPlace: string | null
  equipment: string | null
  physicalAddress: string | null
  receivingCategoryCode: string | null
  capacityUnits: number | null
  allowMixedNomenclature: boolean
  displayName: string | null
  reason: string
}

export function getCellsAiJob(jobId: string): Omit<CellsAiJob, "abort"> | null {
  const job = jobs.get(jobId)
  if (!job) return null
  const { abort: _abort, ...rest } = job
  return rest
}

export function requestCellsAiStop(jobId: string): Omit<CellsAiJob, "abort"> | null {
  const job = jobs.get(jobId)
  if (!job) return null
  if (job.status === "running") {
    job.status = "stopping"
    job.abort.abort()
  }
  const { abort: _abort, ...rest } = job
  return rest
}

function pushLog(job: CellsAiJob, line: CellsAiLogLine) {
  job.log.push(line)
  if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG)
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asText(value: unknown): string {
  return String(value ?? "").trim()
}

function pick(set: Set<string>, raw: unknown): string | null {
  const v = asText(raw).toUpperCase()
  if (!v) return null
  if (set.has(v)) return v
  const lower = asText(raw)
  if (set.has(lower)) return lower
  return null
}

export function startCellsAiJob(input: {
  pool: Pool
  siteCode: string
  apply: boolean
  limit: number
  warehouseCode?: string
  zoneCode?: string
}): CellsAiJob {
  const job: CellsAiJob = {
    id: randomUUID(),
    status: "running",
    apply: input.apply,
    limit: Math.min(CELLS_AI_MAX_LIMIT, Math.max(1, Math.trunc(input.limit) || 30)),
    total: 0,
    processed: 0,
    filled: 0,
    skipped: 0,
    error: null,
    log: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    abort: new AbortController(),
  }
  jobs.set(job.id, job)
  void runCellsAiJob(job, input).catch((error) => {
    if (job.status === "stopping") job.status = "stopped"
    else {
      job.status = "error"
      job.error = error instanceof Error ? error.message : "сбой настройки ячеек"
    }
    job.finishedAt = new Date().toISOString()
  })
  return job
}

async function runCellsAiJob(
  job: CellsAiJob,
  input: { pool: Pool; siteCode: string; warehouseCode?: string; zoneCode?: string }
) {
  const client = await input.pool.connect()
  let fails = 0
  try {
    const siteId = await getSiteId(client, input.siteCode)
    if (siteId == null) throw new Error("unknown siteCode")
    await ensureFgPlacementSchema(client)
    const cells = await loadCellsNeedingSetup(client, siteId, job.limit, input.warehouseCode, input.zoneCode)
    job.total = cells.length
    if (cells.length === 0) {
      job.status = "done"
      job.finishedAt = new Date().toISOString()
      return
    }
    for (let offset = 0; offset < cells.length; offset += BATCH) {
      if (job.abort.signal.aborted) {
        job.status = "stopped"
        job.finishedAt = new Date().toISOString()
        return
      }
      const batch = cells.slice(offset, offset + BATCH)
      const fgBatch = batch.filter(isFgPlanCell)
      const otherBatch = batch.filter((cell) => !isFgPlanCell(cell))
      for (const cell of fgBatch) {
        if (job.abort.signal.aborted) {
          job.status = "stopped"
          job.finishedAt = new Date().toISOString()
          return
        }
        await applyFgPlanCell(client, siteId, job, cell)
        job.processed += 1
      }
      if (otherBatch.length === 0) continue
      let suggestions: LlmCellSuggestion[] = []
      if (llmGatewayConfigured()) {
        try {
          suggestions = await suggestBatch(otherBatch, job.abort.signal)
          fails = 0
        } catch (error) {
          const message = error instanceof Error ? error.message : "сбой ИИ"
          if (message === "остановлено" || job.abort.signal.aborted) {
            job.status = "stopped"
            job.finishedAt = new Date().toISOString()
            return
          }
          fails += 1
          for (const cell of otherBatch) {
            job.processed += 1
            job.skipped += 1
            pushLog(job, {
              locationCode: cell.locationCode,
              warehouseCode: cell.warehouseCode,
              zoneCode: cell.zoneCode,
              materialType: null,
              processType: null,
              title: null,
              lane: null,
              action: "error",
              note: message,
            })
          }
          if (fails >= 3) {
            job.status = "error"
            job.error = "Шлюз ИИ трижды подряд не ответил — остановил."
            job.finishedAt = new Date().toISOString()
            return
          }
          continue
        }
      }
      for (let i = 0; i < otherBatch.length; i += 1) {
        const cell = otherBatch[i]
        if (job.abort.signal.aborted) {
          job.status = "stopped"
          job.finishedAt = new Date().toISOString()
          return
        }
        await applySuggestion(
          client,
          siteId,
          job,
          cell,
          pickSuggestion(cell, suggestions, i, otherBatch.length)
        )
        job.processed += 1
      }
    }
    job.status = job.abort.signal.aborted ? "stopped" : "done"
    job.finishedAt = new Date().toISOString()
  } finally {
    client.release()
  }
}

function attrsFlag(attrs: Record<string, unknown>, key: string): boolean {
  const v = attrs[key]
  return v === true || asText(v).toLowerCase() === "true"
}

function isFgPlanCell(cell: CellRow): boolean {
  const zone = cell.zoneCode.toUpperCase()
  if (zone === "ROWS" || zone === "RECV") return false
  const attrs = jsonObject(cell.locationAttrs)
  if (attrsFlag(attrs, "fgRow") || asText(attrs.planRowId) || asText(attrs.storageModel) === "pallet_row") {
    return true
  }
  if (cell.warehouseCode.toUpperCase() !== "FG") return false
  if (["A", "B", "C", "D", "E", "F", "K"].includes(zone)) return true
  return /^FG-[A-FK]-\d+$/i.test(cell.locationCode)
}

function canWriteFgPlacement(cell: CellRow): boolean {
  const attrs = jsonObject(cell.locationAttrs)
  if (attrsFlag(attrs, "fgRow") || asText(attrs.planRowId) || asText(attrs.storageModel) === "pallet_row") {
    return true
  }
  return /^FG-[A-FK]-\d+$/i.test(cell.locationCode)
}

function fgLanePolicy(cell: CellRow): FgLanePolicy {
  const zone = cell.zoneCode.toUpperCase()
  if (zone === "E") {
    return {
      storageStrategy: "lifo_lane",
      allocationStrategy: "fifo",
      loadSide: "end",
      pickSide: "end",
      label: "LIFO-ряд",
      reason: "Резерв E: тупик, загрузка и отбор с одной стороны · LIFO · FIFO по приходу · класс F",
    }
  }
  if (zone === "SHIP") {
    return {
      storageStrategy: "lifo_lane",
      allocationStrategy: "fifo",
      loadSide: "end",
      pickSide: "end",
      label: "LIFO-ряд",
      reason: "Отгрузка: набор с одной стороны · LIFO · FIFO по приходу · класс F",
    }
  }
  return {
    storageStrategy: "fifo_lane",
    allocationStrategy: "fefo",
    loadSide: "end",
    pickSide: "start",
    label: "FIFO-ряд",
    reason: `Ряд ГП ${zone}: загрузка с конца, отбор с начала · FIFO · FEFO по сроку · класс F`,
  }
}

function fgDraft(policy: FgLanePolicy): RowPlacementDraft {
  return {
    inherit: false,
    isActive: true,
    isBlocked: false,
    storageStrategy: policy.storageStrategy,
    allocationStrategy: policy.allocationStrategy,
    conflictPolicy: "next_accessible",
    allowedMode: "list",
    allowedProducts: [FG_CLASS],
    placementPriority: policy.storageStrategy === "lifo_lane" ? 40 : 80,
    maxOccupancy: 100,
    allowMixedSku: true,
    allowMixedLot: true,
    allowReserve: true,
    allowQuarantine: false,
    loadSide: policy.loadSide,
    pickSide: policy.pickSide,
    useExpiry: policy.allocationStrategy === "fefo",
    useMfg: false,
    minRemainingDays: 0,
  }
}

async function loadCellsNeedingSetup(
  client: PoolClient,
  siteId: number,
  limit: number,
  warehouseCode?: string,
  zoneCode?: string
): Promise<CellRow[]> {
  const r = await client.query<CellRow>(
    `SELECT
       l.location_id::text AS "locationId",
       l.location_code AS "locationCode",
       l.display_name AS "displayName",
       w.warehouse_code AS "warehouseCode",
       z.zone_code AS "zoneCode",
       z.name AS "zoneName",
       l.location_attrs_json AS "locationAttrs",
       fp.storage_strategy AS "placementStrategy",
       COALESCE(SUM(sb.available_qty), 0)::float8 AS qty,
       MIN(i.item_code) FILTER (WHERE COALESCE(sb.available_qty, 0) > 0) AS "occupiedCode",
       MIN(i.name) FILTER (WHERE COALESCE(sb.available_qty, 0) > 0) AS "occupiedName"
     FROM wms_locations l
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
     JOIN wms_zones z ON z.zone_id = l.zone_id
     LEFT JOIN wms_fg_row_placement fp ON fp.site_id = l.site_id AND fp.location_id = l.location_id
     LEFT JOIN wms_stock_balances sb ON sb.location_id = l.location_id AND sb.site_id = l.site_id
     LEFT JOIN wms_items i ON i.item_id = sb.item_id
     WHERE l.site_id = $1
       AND ($2::text = '' OR w.warehouse_code = $2)
       AND ($3::text = '' OR z.zone_code = $3)
       AND (
         (
           (
             COALESCE(l.location_attrs_json->>'fgRow', '') = 'true'
             OR COALESCE(l.location_attrs_json->>'planRowId', '') <> ''
             OR COALESCE(l.location_attrs_json->>'storageModel', '') = 'pallet_row'
             OR l.location_code ILIKE 'FG-%'
             OR (w.warehouse_code = 'FG' AND z.zone_code ~ '^[A-FK]$')
           )
           AND z.zone_code NOT IN ('ROWS', 'RECV')
           AND (
             COALESCE(NULLIF(l.location_attrs_json->'slotProfile'->>'processType', ''), 'ANY') IN ('', 'ANY')
             OR fp.storage_strategy IS NULL
             OR NOT EXISTS (
               SELECT 1
               FROM wms_fg_row_allowed_products ap
               WHERE ap.site_id = l.site_id
                 AND ap.location_id = l.location_id
                 AND ap.match_kind = 'class'
                 AND upper(ap.match_value) IN ('F', 'FG')
             )
           )
         )
         OR NOT (
           COALESCE(l.location_attrs_json->'slotProfile'->>'materialType', 'ANY') NOT IN ('', 'ANY')
           OR COALESCE(l.location_attrs_json->'slotProfile'->>'processType', 'ANY') NOT IN ('', 'ANY')
           OR COALESCE(l.location_attrs_json->'slotProfile'->>'physicalAddress', '') <> ''
           OR COALESCE(l.location_attrs_json->'slotProfile'->>'receivingCategoryCode', '') <> ''
         )
       )
     GROUP BY
       l.location_id, l.location_code, l.display_name, w.warehouse_code, z.zone_code, z.name,
       l.location_attrs_json, fp.storage_strategy
     ORDER BY
       CASE WHEN w.warehouse_code = 'FG' AND z.zone_code ~ '^[A-FK]$' THEN 0 ELSE 1 END,
       CASE WHEN fp.storage_strategy IS NULL THEN 0 ELSE 1 END,
       CASE
         WHEN z.zone_code IN ('ST-SER', 'ST-BAGG', 'RECV', 'STORE') THEN 0
         WHEN z.zone_code IN ('QUARANTINE', 'DEFECT', 'WRITEOFF') THEN 2
         ELSE 1
       END,
       w.warehouse_code,
       z.zone_code,
       l.location_code
     LIMIT $4`,
    [siteId, warehouseCode?.trim() || "", zoneCode?.trim() || "", limit]
  )
  return r.rows
}

async function suggestBatch(cells: CellRow[], signal: AbortSignal): Promise<LlmCellSuggestion[]> {
  const payload = cells.map((cell) => ({
    locationCode: cell.locationCode,
    displayName: cell.displayName,
    warehouseCode: cell.warehouseCode,
    zoneCode: cell.zoneCode,
    zoneName: cell.zoneName,
    occupied: cell.occupiedCode ? `${cell.occupiedCode} ${cell.occupiedName || ""}`.trim() : "",
  }))
  const result = await llmChat(
    [
      {
        role: "system",
        content:
          "Ты настраиваешь профили складских ячеек завода минеральной воды. Верни ТОЛЬКО JSON " +
          '{"cells":[{"locationCode","materialType","processType","stickerShape","productGroup","volume","applicationPlace","equipment","physicalAddress","receivingCategoryCode","capacityUnits","allowMixedNomenclature","displayName","reason"}]}. ' +
          "Коды только из списков. materialType: ST LB PK CP PL ANY. " +
          "processType: SER BAGG CAGG PAGG PACK-WATER DRINK STORE RECV QUARANTINE DEFECT WRITEOFF ANY. " +
          "stickerShape: RND SQR RECT ANY. productGroup: SLNG SLGZ DSLV SLKR DRNK PWTR ANY. " +
          "volume: 05 10 15 50 190 ANY. applicationPlace: CAP BTL BLOCK BOX PALLET ANY. " +
          "equipment: APPLICATOR NOVEXX APPLICATOR-NOVEXX ANY. receivingCategoryCode: stickers water MaterialsFactory или null. " +
          "locationCode копируй один в один из запроса. " +
          "OS+ST-SER → ST/SER/stickers. OS+ST-BAGG → ST/BAGG/BLOCK. OS+RECV → ANY/RECV, mixed true. " +
          "OS+DEFECT → ANY/DEFECT. OS+QUARANTINE → ANY/QUARANTINE. OS+WRITEOFF → ANY/WRITEOFF. " +
          "FG или зона ROWS/STORE/SHIP/A-F → ANY/STORE, water, PALLET, mixed false, capacity 1..4. " +
          "physicalAddress только если это стеллаж (A01-01), для рядов ГП null. Не выдумывай несуществующие коды ячеек.",
      },
      { role: "user", content: `Ячейки без профиля:\n${JSON.stringify(payload)}` },
    ],
    { signal, maxTokens: 1800 }
  )
  const parsed = jsonObject(extractJsonObject(result.text))
  const rows = Array.isArray(parsed.cells)
    ? parsed.cells
    : Array.isArray(parsed.items)
      ? parsed.items
      : []
  const out: LlmCellSuggestion[] = []
  for (const row of rows) {
    const rec = jsonObject(row)
    const locationCode = asText(rec.locationCode)
    if (!locationCode) continue
    const cap = Number(rec.capacityUnits)
    out.push({
      locationCode,
      materialType: pick(MATERIAL, rec.materialType),
      processType: pick(PROCESS, rec.processType),
      stickerShape: pick(SHAPE, rec.stickerShape),
      productGroup: pick(PRODUCT, rec.productGroup),
      volume: pick(VOLUME, rec.volume),
      applicationPlace: pick(PLACE, rec.applicationPlace),
      equipment: pick(EQUIP, rec.equipment),
      physicalAddress: asText(rec.physicalAddress).slice(0, 40) || null,
      receivingCategoryCode: (() => {
        const v = asText(rec.receivingCategoryCode)
        return v && RECV_CAT.has(v) ? v : null
      })(),
      capacityUnits: Number.isFinite(cap) && cap > 0 ? Math.min(9_999_999, Math.trunc(cap)) : null,
      allowMixedNomenclature: rec.allowMixedNomenclature === true,
      displayName: asText(rec.displayName).slice(0, 120) || null,
      reason: asText(rec.reason).slice(0, 240),
    })
  }
  return out
}

function codeKey(value: string): string {
  return value.trim().toUpperCase()
}

function pickSuggestion(
  cell: CellRow,
  suggestions: LlmCellSuggestion[],
  index: number,
  batchLength: number
): LlmCellSuggestion | undefined {
  const exact = suggestions.find((row) => codeKey(row.locationCode) === codeKey(cell.locationCode))
  if (exact) return exact
  if (suggestions.length === 1) return { ...suggestions[0], locationCode: cell.locationCode }
  if (suggestions.length === batchLength && suggestions[index]) {
    return { ...suggestions[index], locationCode: cell.locationCode }
  }
  return undefined
}

function fallbackProfile(cell: CellRow): LlmCellSuggestion {
  const zone = cell.zoneCode.toUpperCase()
  const warehouse = cell.warehouseCode.toUpperCase()
  let materialType: string | null = "ANY"
  let processType: string | null = "STORE"
  let applicationPlace: string | null = "ANY"
  let receivingCategoryCode: string | null = null
  let allowMixedNomenclature = false
  let capacityUnits: number | null = 1
  let reason = `По зоне ${warehouse}/${zone}`

  if (warehouse === "OS" && zone === "ST-SER") {
    materialType = "ST"
    processType = "SER"
    receivingCategoryCode = "stickers"
    reason = "Стеллаж серийных этикеток"
  } else if (warehouse === "OS" && zone === "ST-BAGG") {
    materialType = "ST"
    processType = "BAGG"
    applicationPlace = "BLOCK"
    reason = "Стеллаж блочных этикеток"
  } else if (zone === "RECV") {
    processType = "RECV"
    allowMixedNomenclature = true
    receivingCategoryCode = warehouse === "FG" ? "water" : "MaterialsFactory"
    capacityUnits = 50
    reason = "Зона приёмки, смешанная номенклатура"
  } else if (zone === "QUARANTINE") {
    processType = "QUARANTINE"
    reason = "Карантин"
  } else if (zone === "DEFECT") {
    processType = "DEFECT"
    reason = "Брак"
  } else if (zone === "WRITEOFF") {
    processType = "WRITEOFF"
    reason = "Списание"
  } else if (warehouse === "OS" && zone === "STORE") {
    processType = "STORE"
    allowMixedNomenclature = true
    receivingCategoryCode = "MaterialsFactory"
    reason = "Хранение материалов"
  } else if (warehouse === "FG" || ["STORE", "ROWS", "SHIP"].includes(zone) || /^[A-F]$/.test(zone)) {
    processType = "STORE"
    applicationPlace = "PALLET"
    receivingCategoryCode = "water"
    allowMixedNomenclature = false
    capacityUnits = 1
    reason = "Ряд / хранение готовой продукции"
  }

  return {
    locationCode: cell.locationCode,
    materialType,
    processType,
    stickerShape: "ANY",
    productGroup: "ANY",
    volume: "ANY",
    applicationPlace,
    equipment: "ANY",
    physicalAddress: null,
    receivingCategoryCode,
    capacityUnits,
    allowMixedNomenclature,
    displayName: cell.displayName,
    reason,
  }
}

function suggestionIsUsable(suggestion: LlmCellSuggestion | undefined): suggestion is LlmCellSuggestion {
  return Boolean(
    suggestion && (suggestion.materialType || suggestion.processType || suggestion.receivingCategoryCode)
  )
}

function mergeAttrs(
  existing: unknown,
  suggestion: LlmCellSuggestion,
  extra?: { lane?: string; itemClassCode?: string }
): Record<string, unknown> {
  const base = jsonObject(existing)
  const prev = jsonObject(base.slotProfile)
  return {
    ...base,
    slotProfile: {
      ...prev,
      materialType: suggestion.materialType ?? (asText(prev.materialType) || null),
      processType: suggestion.processType ?? (asText(prev.processType) || null),
      stickerShape: suggestion.stickerShape ?? (asText(prev.stickerShape) || null),
      productGroup: suggestion.productGroup ?? (asText(prev.productGroup) || null),
      volume: suggestion.volume ?? (asText(prev.volume) || null),
      applicationPlace: suggestion.applicationPlace ?? (asText(prev.applicationPlace) || null),
      equipment: suggestion.equipment ?? (asText(prev.equipment) || null),
      physicalAddress: suggestion.physicalAddress ?? (asText(prev.physicalAddress) || null),
      receivingCategoryCode: suggestion.receivingCategoryCode ?? (asText(prev.receivingCategoryCode) || null),
      capacityUnits: suggestion.capacityUnits ?? (Number(prev.capacityUnits) || null),
      allowMixedNomenclature:
        suggestion.allowMixedNomenclature === true || prev.allowMixedNomenclature === true,
      allowMixedBatches: true,
      rememberNomenclature: prev.rememberNomenclature === true,
      itemClassCode: extra?.itemClassCode ?? (asText(prev.itemClassCode) || null),
    },
    aiSlotFill: {
      at: new Date().toISOString(),
      reason: suggestion.reason,
      lane: extra?.lane ?? null,
      itemClassCode: extra?.itemClassCode ?? null,
    },
  }
}

async function applyFgPlanCell(client: PoolClient, siteId: number, job: CellsAiJob, cell: CellRow) {
  const policy = fgLanePolicy(cell)
  const prev = jsonObject(jsonObject(cell.locationAttrs).slotProfile)
  const cap = Number(prev.capacityUnits)
  const suggestion: LlmCellSuggestion = {
    locationCode: cell.locationCode,
    materialType: "ANY",
    processType: "STORE",
    stickerShape: "ANY",
    productGroup: "ANY",
    volume: "ANY",
    applicationPlace: "PALLET",
    equipment: "ANY",
    physicalAddress: asText(prev.physicalAddress) || null,
    receivingCategoryCode: "water",
    capacityUnits: Number.isFinite(cap) && cap > 0 ? cap : null,
    allowMixedNomenclature: prev.allowMixedNomenclature === true,
    displayName: cell.displayName,
    reason: policy.reason,
  }
  if (job.apply) {
    const attrs = mergeAttrs(cell.locationAttrs, suggestion, {
      lane: policy.label,
      itemClassCode: "F",
    })
    await client.query(
      `UPDATE wms_locations
       SET location_attrs_json = $3::jsonb,
           updated_at = now()
       WHERE site_id = $1 AND location_id = $2::bigint`,
      [siteId, cell.locationId, JSON.stringify(attrs)]
    )
    if (canWriteFgPlacement(cell)) {
      try {
        await saveRowDraft(client, siteId, cell.locationId, fgDraft(policy), "cells-ai-fill")
      } catch (error) {
        const message = error instanceof Error ? error.message : "не удалось записать ряд"
        job.skipped += 1
        job.filled -= 1
        pushLog(job, {
          locationCode: cell.locationCode,
          warehouseCode: cell.warehouseCode,
          zoneCode: cell.zoneCode,
          materialType: "ANY",
          processType: "STORE",
          title: `ГП / ${policy.label}`,
          lane: policy.label,
          action: "error",
          note: message,
        })
        return
      }
    }
  }
  job.filled += 1
  pushLog(job, {
    locationCode: cell.locationCode,
    warehouseCode: cell.warehouseCode,
    zoneCode: cell.zoneCode,
    materialType: "ANY",
    processType: "STORE",
    title: `ГП / ${policy.label}`,
    lane: policy.label,
    action: job.apply ? "filled" : "preview",
    note: policy.reason,
  })
}

async function applySuggestion(
  client: PoolClient,
  siteId: number,
  job: CellsAiJob,
  cell: CellRow,
  suggestion: LlmCellSuggestion | undefined
) {
  const resolved = suggestionIsUsable(suggestion) ? suggestion : fallbackProfile(cell)
  if (!suggestionIsUsable(resolved)) {
    job.skipped += 1
    pushLog(job, {
      locationCode: cell.locationCode,
      warehouseCode: cell.warehouseCode,
      zoneCode: cell.zoneCode,
      materialType: null,
      processType: null,
      title: null,
      lane: null,
      action: "skipped",
      note: suggestion?.reason || "ИИ не вернул профиль",
    })
    return
  }
  const title =
    resolved.displayName ||
    [resolved.processType, resolved.materialType, resolved.physicalAddress].filter(Boolean).join(" / ")
  if (job.apply) {
    const attrs = mergeAttrs(cell.locationAttrs, resolved)
    await client.query(
      `UPDATE wms_locations
       SET location_attrs_json = $3::jsonb,
           display_name = CASE
             WHEN COALESCE(NULLIF(display_name, ''), '') = '' AND $4::text <> '' THEN $4
             ELSE display_name
           END,
           updated_at = now()
       WHERE site_id = $1 AND location_code = $2`,
      [siteId, cell.locationCode, JSON.stringify(attrs), title]
    )
  }
  job.filled += 1
  pushLog(job, {
    locationCode: cell.locationCode,
    warehouseCode: cell.warehouseCode,
    zoneCode: cell.zoneCode,
    materialType: resolved.materialType,
    processType: resolved.processType,
    title,
    lane: null,
    action: job.apply ? "filled" : "preview",
    note: resolved.reason || (job.apply ? "записано" : "предпросмотр"),
  })
}
