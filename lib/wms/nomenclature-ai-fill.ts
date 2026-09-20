import { randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import { updateItemMaster } from "@/lib/wms/catalog"
import { extractJsonObject, llmChat, llmGatewayConfigured } from "@/lib/wms/llm-gateway"
import { deriveProductPhysicalProfile, STORAGE_CLASS_META } from "@/lib/wms/physical-profile"
import { getSiteId } from "@/lib/wms/resolve"

export type AiFillLogLine = {
  itemCode: string
  name: string
  groupCode: string | null
  classCode: string | null
  locationCode: string | null
  action: "filled" | "preview" | "skipped" | "error"
  note: string
}

export type AiFillJob = {
  id: string
  status: "running" | "stopping" | "stopped" | "done" | "error"
  apply: boolean
  limit: number
  total: number
  processed: number
  filledGroup: number
  filledClass: number
  placements: number
  skipped: number
  error: string | null
  log: AiFillLogLine[]
  startedAt: string
  finishedAt: string | null
  abort: AbortController
}

const jobs = new Map<string, AiFillJob>()
const BATCH = 8
const MAX_LIMIT = 300
const MAX_LOG = 80

type CatalogItem = {
  itemCode: string
  name: string
  sku: string | null
  itemGroupCode: string | null
  productGroup: string | null
  itemClassCode: string | null
  itemTypeCode: string | null
  itemAttrs: Record<string, unknown> | null
}

type CellCandidate = {
  locationCode: string
  title: string
  warehouseCode: string
  zoneCode: string
}

type LlmItemSuggestion = {
  itemCode: string
  groupCode: string | null
  classCode: string | null
  locationCode: string | null
  reason: string
}

export function getAiFillJob(jobId: string): Omit<AiFillJob, "abort"> | null {
  const job = jobs.get(jobId)
  if (!job) return null
  const { abort: _abort, ...rest } = job
  return rest
}

export function requestAiFillStop(jobId: string): Omit<AiFillJob, "abort"> | null {
  const job = jobs.get(jobId)
  if (!job) return null
  if (job.status === "running") {
    job.status = "stopping"
    job.abort.abort()
  }
  const { abort: _abort, ...rest } = job
  return rest
}

function pushLog(job: AiFillJob, line: AiFillLogLine) {
  job.log.push(line)
  if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG)
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value))
  return String(value ?? "").trim()
}

export function startAiFillJob(input: {
  pool: Pool
  siteCode: string
  apply: boolean
  limit: number
}): AiFillJob {
  if (!llmGatewayConfigured()) {
    throw new Error("На сервере не задан WMS_LLM_API_KEY — шлюз ИИ не подключён")
  }
  const job: AiFillJob = {
    id: randomUUID(),
    status: "running",
    apply: input.apply,
    limit: Math.min(MAX_LIMIT, Math.max(1, Math.trunc(input.limit) || 30)),
    total: 0,
    processed: 0,
    filledGroup: 0,
    filledClass: 0,
    placements: 0,
    skipped: 0,
    error: null,
    log: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    abort: new AbortController(),
  }
  jobs.set(job.id, job)
  void runAiFillJob(job, input.pool, input.siteCode).catch((error) => {
    if (job.status === "stopping") {
      job.status = "stopped"
    } else {
      job.status = "error"
      job.error = error instanceof Error ? error.message : "сбой заполнения ИИ"
    }
    job.finishedAt = new Date().toISOString()
  })
  return job
}

async function runAiFillJob(job: AiFillJob, pool: Pool, siteCode: string) {
  const client = await pool.connect()
  let consecutiveLlmFails = 0
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) throw new Error("unknown siteCode")

    const groups = await loadGroups(client, siteId)
    const classes = await loadClasses(client, siteId)
    const cells = await loadCellCandidates(client, siteId)
    const items = await loadItemsNeedingFill(client, siteId, job.limit)
    job.total = items.length
    if (items.length === 0) {
      job.status = "done"
      job.finishedAt = new Date().toISOString()
      return
    }

    for (let offset = 0; offset < items.length; offset += BATCH) {
      if (job.abort.signal.aborted) {
        job.status = "stopped"
        job.finishedAt = new Date().toISOString()
        return
      }
      const batch = items.slice(offset, offset + BATCH)
      let suggestions: LlmItemSuggestion[] = []
      try {
        suggestions = await suggestBatch(batch, groups, classes, cells, job.abort.signal)
        consecutiveLlmFails = 0
      } catch (error) {
        const message = error instanceof Error ? error.message : "сбой ИИ"
        if (message === "остановлено" || job.abort.signal.aborted) {
          job.status = "stopped"
          job.finishedAt = new Date().toISOString()
          return
        }
        consecutiveLlmFails += 1
        for (const item of batch) {
          if (job.abort.signal.aborted) {
            job.status = "stopped"
            job.finishedAt = new Date().toISOString()
            return
          }
          await applySuggestion(client, siteId, job, item, undefined, groups, classes, cells)
          job.processed += 1
        }
        if (consecutiveLlmFails >= 3) {
          job.status = "error"
          job.error = "Шлюз ИИ трижды подряд не ответил — остановил, чтобы не крутить вхолостую."
          job.finishedAt = new Date().toISOString()
          return
        }
        continue
      }

      const byCode = suggestions
      for (let i = 0; i < batch.length; i += 1) {
        const item = batch[i]
        if (job.abort.signal.aborted) {
          job.status = "stopped"
          job.finishedAt = new Date().toISOString()
          return
        }
        const suggestion = pickItemSuggestion(item, byCode, i, batch.length)
        await applySuggestion(client, siteId, job, item, suggestion, groups, classes, cells)
        job.processed += 1
      }
    }

    job.status = job.abort.signal.aborted ? "stopped" : "done"
    job.finishedAt = new Date().toISOString()
  } finally {
    client.release()
  }
}

async function loadGroups(client: PoolClient, siteId: number): Promise<Array<{ code: string; name: string }>> {
  const r = await client.query<{ code: string; name: string }>(
    `SELECT group_code AS code, COALESCE(NULLIF(name, ''), group_code) AS name
     FROM wms_item_groups
     WHERE site_id = $1 AND COALESCE(is_active, TRUE)
     ORDER BY name`,
    [siteId]
  )
  return r.rows
}

async function loadClasses(client: PoolClient, siteId: number): Promise<Array<{ code: string; name: string }>> {
  const r = await client.query<{ code: string; name: string }>(
    `SELECT class_code AS code, COALESCE(NULLIF(name, ''), class_code) AS name
     FROM wms_item_classes
     WHERE site_id = $1 AND COALESCE(is_active, TRUE)
     ORDER BY class_code`,
    [siteId]
  )
  return r.rows
}

async function loadCellCandidates(client: PoolClient, siteId: number): Promise<CellCandidate[]> {
  const r = await client.query<CellCandidate>(
    `SELECT
       l.location_code AS "locationCode",
       COALESCE(NULLIF(l.display_name, ''), l.location_code) AS title,
       w.warehouse_code AS "warehouseCode",
       z.zone_code AS "zoneCode"
     FROM wms_locations l
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
     JOIN wms_zones z ON z.zone_id = l.zone_id
     LEFT JOIN wms_stock_balances sb
       ON sb.location_id = l.location_id AND sb.site_id = l.site_id
     WHERE l.site_id = $1
       AND w.warehouse_code IN ('OS', 'FG')
       AND z.zone_code IN ('STORE', 'RECV', 'A', 'ROWS', 'ST-SER', 'ST-BAGG', 'SHIP')
     GROUP BY l.location_id, l.location_code, l.display_name, w.warehouse_code, z.zone_code
     ORDER BY COALESCE(SUM(sb.available_qty), 0), l.location_code
     LIMIT 40`,
    [siteId]
  )
  return r.rows
}

async function loadItemsNeedingFill(client: PoolClient, siteId: number, limit: number): Promise<CatalogItem[]> {
  const r = await client.query<CatalogItem>(
    `SELECT
       item_code AS "itemCode",
       name,
       sku,
       item_group_code AS "itemGroupCode",
       product_group AS "productGroup",
       item_class_code AS "itemClassCode",
       item_type_code AS "itemTypeCode",
       item_attrs_json AS "itemAttrs"
     FROM wms_items
     WHERE site_id = $1
       AND COALESCE(is_active, TRUE)
       AND (
         COALESCE(item_group_code, '') = ''
         OR COALESCE(item_class_code, '') = ''
         OR COALESCE(item_attrs_json->'storageSuggest'->>'locationCode', '') = ''
       )
     ORDER BY
       CASE WHEN COALESCE(item_group_code, '') = '' THEN 0 ELSE 1 END,
       CASE WHEN COALESCE(item_class_code, '') = '' THEN 0 ELSE 1 END,
       item_id DESC
     LIMIT $2`,
    [siteId, limit]
  )
  return r.rows
}

async function suggestBatch(
  items: CatalogItem[],
  groups: Array<{ code: string; name: string }>,
  classes: Array<{ code: string; name: string }>,
  cells: CellCandidate[],
  signal: AbortSignal
): Promise<LlmItemSuggestion[]> {
  const allowedGroups = groups.map((g) => `${g.code} :: ${g.name}`).join("\n")
  const allowedClasses = classes.map((c) => `${c.code} :: ${c.name}`).join("\n")
  const allowedCells = cells
    .map((c) => `${c.locationCode} :: ${c.warehouseCode}/${c.zoneCode} ${c.title}`)
    .join("\n")
  const payload = items.map((item) => ({
    itemCode: item.itemCode,
    name: item.name,
    sku: item.sku,
    currentGroup: item.itemGroupCode || item.productGroup || "",
    currentClass: item.itemClassCode || "",
  }))

  const result = await llmChat(
    [
      {
        role: "system",
        content:
          "Ты классификатор склада минеральной воды (этикетки, стикеры, преформа, колпачки, ГП). " +
          "Верни ТОЛЬКО JSON вида {\"items\":[{\"itemCode\",\"groupCode\",\"classCode\",\"locationCode\",\"reason\"}]}. " +
          "groupCode — только код из списка групп, classCode — S1/S2/S3/S4/S5 из списка классов, " +
          "locationCode — только код ячейки из списка или null. " +
          "itemCode копируй СТРОКОЙ один в один, не числом и не обрезай нули. " +
          "Не выдумывай SKU и не меняй уже заполненную группу. " +
          "Стикеры, этикетки, крепёж, канцелярия → S1 и склад OS. " +
          "Картон, плёнка, короба, преформа, мешки, клей, суспензия → S3 (сырьё линии). " +
          "Готовая вода и напитки → S4 и склад FG. Брак/карантин → S5. Услуги можно пропустить (null).",
      },
      {
        role: "user",
        content:
          `Группы:\n${allowedGroups}\n\nКлассы:\n${allowedClasses}\n\nЯчейки:\n${allowedCells || "(нет)"}\n\nПозиции:\n${JSON.stringify(payload)}`,
      },
    ],
    { signal, maxTokens: 1600 }
  )

  const parsed = jsonObject(extractJsonObject(result.text))
  const rows = Array.isArray(parsed.items)
    ? parsed.items
    : Array.isArray(parsed.rows)
      ? parsed.rows
      : []
  const groupByToken = new Map<string, string>()
  for (const g of groups) {
    groupByToken.set(g.code.toLowerCase(), g.code)
    groupByToken.set(g.name.toLowerCase(), g.code)
  }
  const classCodes = new Set(classes.map((c) => c.code.toUpperCase()))
  const cellCodes = new Set(cells.map((c) => c.locationCode))
  const out: LlmItemSuggestion[] = []
  for (const row of rows) {
    const rec = jsonObject(row)
    const itemCode = asText(rec.itemCode) || asText(rec.code) || asText(rec.sku)
    if (!itemCode) continue
    const groupRaw = asText(rec.groupCode)
    const classCode = asText(rec.classCode).toUpperCase()
    const locationCode = asText(rec.locationCode)
    out.push({
      itemCode,
      groupCode: groupRaw ? groupByToken.get(groupRaw.toLowerCase()) || null : null,
      classCode: classCode && classCodes.has(classCode) ? classCode : null,
      locationCode: locationCode && cellCodes.has(locationCode) ? locationCode : null,
      reason: asText(rec.reason).slice(0, 240),
    })
  }
  return out
}

function codeKey(value: string): string {
  const t = asText(value)
  const digits = t.replace(/\D/g, "")
  if (digits.length >= 8) return digits.replace(/^0+/, "") || "0"
  return t.toLowerCase()
}

function blobOf(item: CatalogItem): string {
  return `${item.name} ${item.itemGroupCode || ""} ${item.productGroup || ""} ${item.sku || ""}`.toLowerCase()
}

function looksSticker(item: CatalogItem): boolean {
  return /стикер|этикет|sticker|\blabel\b/.test(blobOf(item))
}

function looksMaterial(item: CatalogItem): boolean {
  return /преформ|колпач|картон|плёнк|пленк|клей|сырь|материал|пробк|крышк/.test(blobOf(item))
}

function looksFinishedGoods(item: CatalogItem): boolean {
  if (looksSticker(item) || looksMaterial(item)) return false
  return /вода|напиток|slavda|славда|монастырск|медвежк/.test(blobOf(item))
}

function pickItemSuggestion(
  item: CatalogItem,
  suggestions: LlmItemSuggestion[],
  index: number,
  batchLength: number
): LlmItemSuggestion | undefined {
  const key = codeKey(item.itemCode)
  const exact = suggestions.find(
    (row) => codeKey(row.itemCode) === key || codeKey(row.itemCode) === codeKey(item.sku || "")
  )
  if (exact) return { ...exact, itemCode: item.itemCode }
  if (suggestions.length === 1) return { ...suggestions[0], itemCode: item.itemCode }
  if (suggestions.length === batchLength && suggestions[index]) {
    return { ...suggestions[index], itemCode: item.itemCode }
  }
  return undefined
}

function pickCell(
  cells: CellCandidate[],
  warehouse: "OS" | "FG",
  zones: string[]
): CellCandidate | undefined {
  for (const zone of zones) {
    const hit = cells.find((c) => c.warehouseCode === warehouse && c.zoneCode === zone)
    if (hit) return hit
  }
  return cells.find((c) => c.warehouseCode === warehouse) || cells[0]
}

function fallbackSuggestion(
  item: CatalogItem,
  groups: Array<{ code: string; name: string }>,
  cells: CellCandidate[]
): LlmItemSuggestion {
  const groupByToken = new Map<string, string>()
  for (const g of groups) {
    groupByToken.set(g.code.toLowerCase(), g.code)
    groupByToken.set(g.name.toLowerCase(), g.code)
  }
  let groupCode: string | null = null
  let classCode: string | null = null
  let cell: CellCandidate | undefined
  let reason = "По названию"

  const derived = deriveProductPhysicalProfile({
    name: item.name,
    itemTypeCode: item.itemTypeCode,
    itemClassCode: item.itemClassCode,
    itemGroupCode: item.itemGroupCode,
    productGroup: item.productGroup,
  })
  classCode = derived.storageClass

  if (looksSticker(item)) {
    groupCode = groupByToken.get("stickers") || groupByToken.get("стикеры") || null
    if (!groupCode && /скит/.test(blobOf(item))) groupCode = groupByToken.get("стикеры скит") || null
    if (!groupCode && /пмв/.test(blobOf(item))) groupCode = groupByToken.get("стикеры пмв") || null
    cell = pickCell(cells, "OS", ["ST-SER", "ST-BAGG", "STORE", "RECV"])
    reason = `Стикер / этикетка → ${STORAGE_CLASS_META.S1.short}, склад материалов`
  } else if (looksMaterial(item)) {
    cell = pickCell(cells, "OS", ["STORE", "RECV", "ST-BAGG"])
    reason = `${STORAGE_CLASS_META[derived.storageClass].short} → склад материалов`
  } else if (looksFinishedGoods(item)) {
    groupCode = groupByToken.get("water") || groupByToken.get("вода") || null
    cell = pickCell(cells, "FG", ["ROWS", "A", "STORE", "SHIP"])
    reason = "Готовая вода / напиток → S4 · Палетный, склад ГП"
  } else {
    reason = `${STORAGE_CLASS_META[derived.storageClass].short} по названию`
  }

  return {
    itemCode: item.itemCode,
    groupCode,
    classCode,
    locationCode: cell?.locationCode || null,
    reason,
  }
}

async function applySuggestion(
  client: PoolClient,
  siteId: number,
  job: AiFillJob,
  item: CatalogItem,
  suggestion: LlmItemSuggestion | undefined,
  groups: Array<{ code: string; name: string }>,
  classes: Array<{ code: string; name: string }>,
  cells: CellCandidate[]
) {
  const fallback = fallbackSuggestion(item, groups, cells)
  const merged: LlmItemSuggestion = {
    itemCode: item.itemCode,
    groupCode: suggestion?.groupCode || fallback.groupCode,
    classCode: suggestion?.classCode || fallback.classCode,
    locationCode: suggestion?.locationCode || fallback.locationCode,
    reason: suggestion?.reason || fallback.reason,
  }

  const hasGroup = Boolean((item.itemGroupCode || "").trim())
  const hasClass = Boolean((item.itemClassCode || "").trim())
  const groupCode = hasGroup ? null : merged.groupCode
  const classCode = hasClass ? null : merged.classCode
  const locationCode = merged.locationCode
  const cell = locationCode ? cells.find((c) => c.locationCode === locationCode) : undefined
  const nextType = nextItemType(item)
  const typeChanged = Boolean(nextType && nextType !== (item.itemTypeCode || "").trim())

  if (!groupCode && !classCode && !locationCode && !typeChanged) {
    job.skipped += 1
    pushLog(job, {
      itemCode: item.itemCode,
      name: item.name,
      groupCode: null,
      classCode: null,
      locationCode: null,
      action: "skipped",
      note: suggestion
        ? merged.reason || "нечего заполнять"
        : "модель не вернула код позиции, и по названию нечего проставить",
    })
    return
  }

  if (job.apply) {
    const patch: {
      itemGroupCode?: string
      productGroup?: string
      itemClassCode?: string
      itemTypeCode?: string
      itemAttrs?: Record<string, unknown>
    } = {}
    if (groupCode) {
      patch.itemGroupCode = groupCode
      patch.productGroup = groups.find((g) => g.code === groupCode)?.name || groupCode
    }
    if (classCode) patch.itemClassCode = classCode
    if (typeChanged && nextType) patch.itemTypeCode = nextType
    if (locationCode && cell) {
      const currentAttrs =
        item.itemAttrs && typeof item.itemAttrs === "object" && !Array.isArray(item.itemAttrs)
          ? item.itemAttrs
          : {}
      patch.itemAttrs = {
        ...currentAttrs,
        storageSuggest: {
          locationCode: cell.locationCode,
          warehouseCode: cell.warehouseCode,
          zoneCode: cell.zoneCode,
          reason: merged.reason,
          at: new Date().toISOString(),
        },
      }
    }
    await updateItemMaster(client, siteId, item.itemCode, patch)
  }

  if (groupCode) job.filledGroup += 1
  if (classCode) job.filledClass += 1
  if (locationCode) job.placements += 1
  const groupName = groupCode ? groups.find((g) => g.code === groupCode)?.name || groupCode : null
  const className = classCode ? classes.find((c) => c.code === classCode)?.name || classCode : null
  pushLog(job, {
    itemCode: item.itemCode,
    name: item.name,
    groupCode: groupName,
    classCode: className,
    locationCode: locationCode,
    action: job.apply ? "filled" : "preview",
    note: merged.reason || (job.apply ? "записано" : "предпросмотр"),
  })
}

function nextItemType(item: CatalogItem): string | null {
  const current = (item.itemTypeCode || "").trim()
  const keep = new Set(["materials", "stickers", "finished_goods", "packaging", "components", "equipment"])
  if (keep.has(current)) return null
  if (looksSticker(item)) return "stickers"
  if (looksMaterial(item)) return "materials"
  if (looksFinishedGoods(item)) return "finished_goods"
  return null
}
