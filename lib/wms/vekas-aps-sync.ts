import type { PoolClient } from "pg"
import { resolveItemByCodeOrBarcode } from "@/lib/wms/resolve"
import {
  createProductionPlan,
  updateProductionPlan,
  updateProductionPlanProgress,
} from "@/lib/wms/production-plan-directory"
import { normalizePlanCode } from "@/lib/wms/production-plan-meta"
import { importVekasBatchToFg, ensureFgVekasLotsSchema } from "@/lib/wms/fg-vekas-lots"

const IN_PROCESS_STATUSES = ["InProccess", "InProcess"] as const
const DONE_STATUSES = ["InStorage", "Completed", "InArchive", "Finalized"] as const
const CANCELLED_STATUSES = ["Cancelled", "Canceled"] as const

export type VekasApsServer = "skit" | "slavda"

export type VekasApsWatchRow = {
  watchId: string
  vekasServer: VekasApsServer
  vekasBatchId: string
  batchNumber: string | null
  vekasStatus: string | null
  watchState: "watching" | "completed" | "skipped"
  gtin: string | null
  productName: string | null
  lineCode: string | null
  productionDate: string | null
  planId: string | null
  planCode: string | null
  producedQty: number | null
  lastError: string | null
  firstSeenAt: string | null
  lastPolledAt: string | null
  completedAt: string | null
  startedAt: string | null
  finishedAt: string | null
}

export type VekasApsSyncResult = {
  listed: number
  watching: number
  createdPlans: number
  attachedPlans: number
  completed: number
  skipped: number
  historyImported: number
  historyRemaining: number
  qtyBackfilled: number
  fgImported: number
  fgHistoryRemaining?: number
  errors: string[]
  watches: VekasApsWatchRow[]
}

type AdapterBatch = {
  id?: string
  batchNumber?: string | null
  status?: string | null
  gtin?: string | null
  productName?: string | null
  productLineName?: string | null
  productionDate?: string | null
  createdOn?: string | null
  startDate?: string | null
  finalizationDate?: string | null
}

const FACTORY_TZ = "Asia/Vladivostok"

function parseVekasTs(value: string | null | undefined): Date | null {
  if (!value) return null
  let raw = String(value).trim()
  if (!raw) return null
  raw = raw.replace(/\.(\d{3})\d+/, ".$1")
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    raw = `${raw}+10:00`
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function factoryDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FACTORY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function vekasStartedAt(batch: AdapterBatch): Date | null {
  return parseVekasTs(batch.startDate) ?? parseVekasTs(batch.createdOn)
}

function vekasFinishedAt(batch: AdapterBatch): Date | null {
  return parseVekasTs(batch.finalizationDate)
}

function planDatesFromBatch(batch: AdapterBatch): { planDate: string; planDateTo: string | null } {
  const start = vekasStartedAt(batch)
  const finish = vekasFinishedAt(batch)
  const rawProd = (batch.productionDate ?? "").trim()
  const planDate = start
    ? factoryDayKey(start)
    : /^\d{4}-\d{2}-\d{2}/.test(rawProd)
      ? rawProd.slice(0, 10)
      : factoryDayKey(new Date())
  const inProcess = (IN_PROCESS_STATUSES as readonly string[]).includes((batch.status ?? "").trim())
  const endDay = finish ? factoryDayKey(finish) : inProcess ? factoryDayKey(new Date()) : planDate
  return { planDate, planDateTo: endDay > planDate ? endDay : null }
}

function adapterBase(): string {
  return (process.env.VEKAS_ADAPTER_URL || "http://127.0.0.1:8792").trim().replace(/\/$/, "")
}

async function adapterJson<T>(path: string, timeoutMs = 120_000): Promise<T> {
  const res = await fetch(`${adapterBase()}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(data.error || `vekas adapter HTTP ${res.status}`)
  }
  return data
}

function isInProcess(status: string | null | undefined): boolean {
  const s = (status ?? "").trim()
  return (IN_PROCESS_STATUSES as readonly string[]).includes(s)
}

function isDoneStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").trim()
  return (DONE_STATUSES as readonly string[]).includes(s)
}

function isCancelledStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").trim()
  return (CANCELLED_STATUSES as readonly string[]).includes(s)
}

function todayKey(): string {
  return factoryDayKey(new Date())
}

function dateKey(value: string | null | undefined): string {
  const raw = (value ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  return todayKey()
}

function shiftDayKey(day: string, deltaDays: number): string {
  const [y, m, d] = day.split("-").map(Number)
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, (d || 1) + deltaDays))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`
}

function batchDayKey(batch: AdapterBatch): string {
  return dateKey(batch.productionDate || batch.startDate || batch.createdOn)
}

function externalIdOf(
  server: VekasApsServer,
  batchNumber: string,
  gtin?: string | null,
  batchId?: string | null
): string {
  const num = batchNumber.trim() || String(batchId || "").trim()
  const g = (gtin || "").trim()
  return g ? `${server}:${num}:${g}` : `${server}:${num}`
}

function preferredPlanCode(batchNumber: string, gtin?: string | null): string {
  const base = normalizePlanCode(batchNumber)
  const tail = (gtin || "").trim().slice(-4)
  return tail ? normalizePlanCode(`${batchNumber}-${tail}`) : base
}

function batchKey(server: string, batchNumber?: string | null, gtin?: string | null, batchId?: string | null): string {
  return `${server}:${String(batchNumber || "").trim()}:${String(gtin || "").trim() || String(batchId || "").trim()}`
}

/**
 * Схема доводится один раз за жизнь процесса: этот блок пересоздаёт CHECK на
 * wms_production_plans, то есть берёт исключительную блокировку таблицы. На
 * каждой загрузке календаря такое делать нельзя.
 */
let vekasSchemaReady = false

export async function ensureVekasApsSchema(client: PoolClient): Promise<void> {
  if (vekasSchemaReady) return
  await client.query(`
    ALTER TABLE wms_production_plans DROP CONSTRAINT IF EXISTS ck_wms_production_plans_external_source;
    ALTER TABLE wms_production_plans
      ADD CONSTRAINT ck_wms_production_plans_external_source
      CHECK (external_source IN ('manual', '1c', 'import', 'vekas'));
    CREATE TABLE IF NOT EXISTS wms_vekas_aps_watches (
      watch_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL REFERENCES wms_sites(site_id),
      vekas_server TEXT NOT NULL,
      vekas_batch_id TEXT NOT NULL,
      batch_number TEXT NULL,
      vekas_status TEXT NULL,
      watch_state TEXT NOT NULL DEFAULT 'watching',
      gtin TEXT NULL,
      product_name TEXT NULL,
      line_code TEXT NULL,
      production_date DATE NULL,
      plan_id BIGINT NULL REFERENCES wms_production_plans(plan_id) ON DELETE SET NULL,
      produced_qty NUMERIC(18, 6) NULL,
      last_error TEXT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_polled_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      UNIQUE (site_id, vekas_server, vekas_batch_id)
    );
    CREATE INDEX IF NOT EXISTS ix_wms_vekas_aps_watches_state
      ON wms_vekas_aps_watches(site_id, watch_state, last_polled_at);
    ALTER TABLE wms_vekas_aps_watches ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL;
    ALTER TABLE wms_vekas_aps_watches ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ NULL;
  `)
  vekasSchemaReady = true
  await ensureFgVekasLotsSchema(client)
}

async function listInProcessBatches(server: VekasApsServer): Promise<AdapterBatch[]> {
  const seen = new Set<string>()
  const items: AdapterBatch[] = []
  for (const status of IN_PROCESS_STATUSES) {
    const data = await adapterJson<{ items?: AdapterBatch[] }>(
      `/api/wms/vekas/batches?server=${server}&status=${encodeURIComponent(status)}&take=200`
    )
    for (const row of data.items ?? []) {
      const id = String(row.id || "").trim()
      if (!id || seen.has(id) || !isInProcess(row.status)) continue
      seen.add(id)
      items.push(row)
    }
  }
  return items
}

async function listRecentClosedBatches(server: VekasApsServer, dayFrom: string): Promise<AdapterBatch[]> {
  const seen = new Set<string>()
  const items: AdapterBatch[] = []
  for (let skip = 0; skip < 2400; skip += 200) {
    const data = await adapterJson<{ items?: AdapterBatch[] }>(
      `/api/wms/vekas/batches?server=${server}&applied_only=true&take=200&skip=${skip}`
    )
    const page = data.items ?? []
    if (!page.length) break
    for (const row of page) {
      const id = String(row.id || "").trim()
      if (!id || seen.has(id)) continue
      if (isInProcess(row.status) || isCancelledStatus(row.status) || !isDoneStatus(row.status)) continue
      if (batchDayKey(row) < dayFrom) continue
      seen.add(id)
      items.push(row)
    }
    const oldest = page[page.length - 1]
    if (page.length < 200 || batchDayKey(oldest) < dayFrom) break
  }
  return items
}

async function loadBatch(
  server: VekasApsServer,
  batchId: string,
  batchNumber?: string | null
): Promise<AdapterBatch | null> {
  try {
    return await adapterJson<AdapterBatch>(
      `/api/wms/vekas/batches/${encodeURIComponent(batchId)}?server=${server}`
    )
  } catch {
    const q = String(batchNumber || batchId).trim()
    const listed = await adapterJson<{ items?: AdapterBatch[] }>(
      `/api/wms/vekas/batches?server=${server}&batchNumber=${encodeURIComponent(q)}&applied_only=false&take=10`
    )
    return (
      (listed.items ?? []).find((row) => row.id === batchId || row.batchNumber === batchNumber) ??
      listed.items?.[0] ??
      null
    )
  }
}

async function countProducedBottles(server: VekasApsServer, batchId: string): Promise<number> {
  const validated = await adapterJson<{ total?: number }>(
    `/api/wms/vekas/batches/${encodeURIComponent(batchId)}/codes?server=${server}&validatedOnly=1&take=1`
  )
  const validatedTotal = Number(validated.total || 0)
  if (validatedTotal > 0) return validatedTotal
  const all = await adapterJson<{ total?: number }>(
    `/api/wms/vekas/batches/${encodeURIComponent(batchId)}/codes?server=${server}&validatedOnly=0&take=1`
  )
  return Number(all.total || 0)
}

function gtinLookupCandidates(gtin: string): string[] {
  const raw = gtin.trim()
  const digits = raw.replace(/\D/g, "")
  const out = new Set<string>()
  if (raw) out.add(raw)
  if (/^\d{13,14}$/.test(digits)) {
    const g14 = digits.padStart(14, "0").slice(-14)
    out.add(g14)
    if (g14.startsWith("0")) out.add(g14.slice(1))
  }
  return [...out]
}

function isStickerName(name: string | null | undefined): boolean {
  return /^стикер\b/i.test((name || "").trim())
}

async function ensureVekasLineItem(
  client: PoolClient,
  siteId: number,
  gtin: string | null,
  productName: string | null
): Promise<string | null> {
  const name = (productName || "").trim()
  const rawGtin = (gtin || "").trim()
  if (rawGtin) {
    for (const cand of gtinLookupCandidates(rawGtin)) {
      const byGtin = await resolveItemByCodeOrBarcode(client, siteId, cand)
      if (byGtin?.item_code && !isStickerName(byGtin.name)) return byGtin.item_code
    }
  }
  if (!rawGtin || !name) return null
  const g14 = rawGtin.replace(/\D/g, "").padStart(14, "0").slice(-14)
  if (!/^\d{14}$/.test(g14)) return null
  const attrs = {
    nomenclature: { gtin: g14, source: "vekas-line" },
    markingPackaging: { productGtin: g14 },
  }
  const ins = await client.query<{ item_code: string }>(
    `INSERT INTO wms_items (
       site_id, item_code, name, item_type_code, item_subgroup, uom_code,
       is_marked, is_active, item_attrs_json, created_at, updated_at
     ) VALUES ($1, $2, $3, 'finished_goods', NULL, 'pcs', TRUE, TRUE, $4::jsonb, now(), now())
     ON CONFLICT (site_id, item_code) DO UPDATE SET
       is_active = TRUE,
       name = CASE
         WHEN wms_items.name ~* '^стикер' OR NULLIF(BTRIM(wms_items.name), '') IS NULL THEN EXCLUDED.name
         ELSE wms_items.name
       END,
       item_attrs_json = COALESCE(wms_items.item_attrs_json, '{}'::jsonb) || EXCLUDED.item_attrs_json,
       updated_at = now()
     RETURNING item_code`,
    [siteId, g14, name, JSON.stringify(attrs)]
  )
  await client.query(
    `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
     SELECT i.item_id, $2, 'gtin', TRUE, now()
     FROM wms_items i
     WHERE i.site_id = $1 AND i.item_code = $3
       AND NOT EXISTS (SELECT 1 FROM wms_item_barcodes b WHERE b.barcode = $2)`,
    [siteId, g14, g14]
  )
  return ins.rows[0]?.item_code ?? null
}

async function resolveItemCode(
  client: PoolClient,
  siteId: number,
  gtin: string | null,
  productName: string | null
): Promise<string | null> {
  return ensureVekasLineItem(client, siteId, gtin, productName)
}

async function findExistingPlan(
  client: PoolClient,
  siteId: number,
  externalId: string,
  batchNumber?: string,
  gtin?: string | null
): Promise<{ planId: string; planCode: string; status: string } | null> {
  const byExt = await client.query<{ plan_id: string; plan_code: string; status_code: string }>(
    `SELECT plan_id::text, plan_code, status_code
     FROM wms_production_plans
     WHERE site_id = $1 AND external_source = 'vekas' AND external_id = $2
     LIMIT 1`,
    [siteId, externalId]
  )
  if (byExt.rows[0]) {
    return {
      planId: byExt.rows[0].plan_id,
      planCode: byExt.rows[0].plan_code,
      status: byExt.rows[0].status_code,
    }
  }
  const codes = new Set<string>()
  const num = String(batchNumber || "").trim()
  if (num) {
    const base = normalizePlanCode(num)
    if (base) codes.add(base.toUpperCase())
    const preferred = preferredPlanCode(num, gtin)
    if (preferred) codes.add(preferred.toUpperCase())
    codes.add(num.toUpperCase())
  }
  if (codes.size === 0) return null
  const byCode = await client.query<{ plan_id: string; plan_code: string; status_code: string }>(
    `SELECT plan_id::text, plan_code, status_code
     FROM wms_production_plans
     WHERE site_id = $1 AND upper(plan_code) = ANY($2::text[])
     ORDER BY CASE WHEN external_source = 'vekas' THEN 0 ELSE 1 END, plan_id DESC
     LIMIT 1`,
    [siteId, [...codes]]
  )
  if (!byCode.rows[0]) return null
  return {
    planId: byCode.rows[0].plan_id,
    planCode: byCode.rows[0].plan_code,
    status: byCode.rows[0].status_code,
  }
}

async function ensurePlan(
  client: PoolClient,
  siteId: number,
  batch: AdapterBatch,
  server: VekasApsServer,
  opts?: { closed?: boolean }
): Promise<{ planId: string; planCode: string; created: boolean; attached: boolean } | { skipped: string }> {
  const batchNumber = String(batch.batchNumber || "").trim()
  const externalId = externalIdOf(server, batchNumber, batch.gtin, batch.id)
  const { planDate, planDateTo } = planDatesFromBatch(batch)
  const lineCode = String(batch.productLineName || "").trim() || null
  const itemCode = await resolveItemCode(client, siteId, batch.gtin ?? null, batch.productName ?? null)
  if (!itemCode) {
    return { skipped: `нет номенклатуры для ${batchNumber || batch.id} (${batch.gtin || batch.productName || "без GTIN"})` }
  }

  const closed = opts?.closed === true
  const existing = await findExistingPlan(client, siteId, externalId, batchNumber, batch.gtin)
  if (existing) {
    if (existing.status !== "reserved") {
      const keepClosed = closed || existing.status === "done"
      await updateProductionPlan(client, siteId, existing.planCode, {
        status: keepClosed ? undefined : "in_progress",
        lineCode: lineCode ?? undefined,
        planDate,
        planDateTo,
        note: keepClosed ? undefined : `Векас ${batchNumber || batch.id}: в процессе`,
        syncCalendar: !keepClosed,
      })
    }
    if (!existing.status || existing.status === "draft" || existing.status === "checked" || existing.status === "in_progress") {
      await client.query(
        `UPDATE wms_production_plans
         SET external_source = CASE WHEN external_source = 'manual' THEN 'vekas' ELSE external_source END,
             external_id = COALESCE(NULLIF(external_id, ''), $3),
             updated_at = now()
         WHERE plan_id = $1::bigint AND site_id = $2`,
        [existing.planId, siteId, externalId]
      )
    }
    return { planId: existing.planId, planCode: existing.planCode, created: false, attached: true }
  }

  const preferredCode = batchNumber ? preferredPlanCode(batchNumber, batch.gtin) : ""
  const taken = preferredCode
    ? await client.query<{ plan_id: string; plan_code: string; status_code: string }>(
        `SELECT plan_id::text, plan_code, status_code
         FROM wms_production_plans
         WHERE site_id = $1 AND upper(plan_code) = $2
         LIMIT 1`,
        [siteId, preferredCode.toUpperCase()]
      )
    : { rows: [] }
  if (taken.rows[0]) {
    return {
      planId: taken.rows[0].plan_id,
      planCode: taken.rows[0].plan_code,
      created: false,
      attached: true,
    }
  }
  const plan = await createProductionPlan(client, siteId, {
    code: preferredCode || undefined,
    planDate,
    planDateTo,
    itemCode,
    plannedQty: 1,
    lineCode,
    externalSource: "vekas",
    externalId,
    note: closed
      ? `Векас ${batchNumber || batch.id}: на складе`
      : `Векас ${batchNumber || batch.id}: в процессе, факт после статуса «На складе»`,
    syncCalendar: !closed,
    skipMaterials: true,
  })
  if (!closed) {
    await updateProductionPlan(client, siteId, plan.code, { status: "in_progress", syncCalendar: true })
  }
  return { planId: plan.planId, planCode: plan.code, created: true, attached: false }
}

async function upsertWatch(
  client: PoolClient,
  siteId: number,
  server: VekasApsServer,
  batch: AdapterBatch
): Promise<string> {
  const startedAt = vekasStartedAt(batch)
  const finishedAt = vekasFinishedAt(batch)
  const r = await client.query<{ watch_id: string }>(
    `INSERT INTO wms_vekas_aps_watches (
       site_id, vekas_server, vekas_batch_id, batch_number, vekas_status, watch_state,
       gtin, product_name, line_code, production_date, last_polled_at, started_at, finished_at
     ) VALUES ($1, $2, $3, $4, $5, 'watching', $6, $7, $8, $9::date, now(), $10::timestamptz, $11::timestamptz)
     ON CONFLICT (site_id, vekas_server, vekas_batch_id) DO UPDATE SET
       batch_number = EXCLUDED.batch_number,
       vekas_status = EXCLUDED.vekas_status,
       gtin = COALESCE(EXCLUDED.gtin, wms_vekas_aps_watches.gtin),
       product_name = COALESCE(EXCLUDED.product_name, wms_vekas_aps_watches.product_name),
       line_code = COALESCE(EXCLUDED.line_code, wms_vekas_aps_watches.line_code),
       production_date = COALESCE(EXCLUDED.production_date, wms_vekas_aps_watches.production_date),
       started_at = COALESCE(EXCLUDED.started_at, wms_vekas_aps_watches.started_at),
       finished_at = CASE
         WHEN EXCLUDED.finished_at IS NOT NULL THEN EXCLUDED.finished_at
         WHEN EXCLUDED.vekas_status IN ('InProccess', 'InProcess') THEN NULL
         ELSE wms_vekas_aps_watches.finished_at
       END,
       last_polled_at = now(),
       last_error = CASE
         WHEN wms_vekas_aps_watches.watch_state = 'completed' THEN wms_vekas_aps_watches.last_error
         ELSE NULL
       END
     RETURNING watch_id::text`,
    [
      siteId,
      server,
      String(batch.id || "").trim(),
      String(batch.batchNumber || "").trim() || null,
      String(batch.status || "").trim() || null,
      String(batch.gtin || "").trim() || null,
      String(batch.productName || "").trim() || null,
      String(batch.productLineName || "").trim() || null,
      batch.productionDate ? dateKey(batch.productionDate) : null,
      startedAt?.toISOString() ?? null,
      finishedAt?.toISOString() ?? null,
    ]
  )
  return r.rows[0]!.watch_id
}

async function persistWatchTimes(
  client: PoolClient,
  siteId: number,
  watchId: string,
  batch: AdapterBatch
): Promise<void> {
  const startedAt = vekasStartedAt(batch)
  const finishedAt = vekasFinishedAt(batch)
  await client.query(
    `UPDATE wms_vekas_aps_watches
     SET started_at = COALESCE($3::timestamptz, started_at),
         finished_at = CASE
           WHEN $4::timestamptz IS NOT NULL THEN $4::timestamptz
           WHEN vekas_status IN ('InProccess', 'InProcess') OR watch_state = 'watching' THEN NULL
           ELSE finished_at
         END,
         last_polled_at = now()
     WHERE watch_id = $1::bigint AND site_id = $2`,
    [watchId, siteId, startedAt?.toISOString() ?? null, finishedAt?.toISOString() ?? null]
  )
}

async function completeWatch(
  client: PoolClient,
  siteId: number,
  watch: {
    watchId: string
    vekasServer: VekasApsServer
    vekasBatchId: string
    batchNumber: string | null
    planId: string | null
  },
  status: string,
  qty: number | null,
  times?: { startedAt?: Date | null; finishedAt?: Date | null }
): Promise<void> {
  if (watch.planId) {
    const planRow = await client.query<{ plan_code: string; status_code: string }>(
      `SELECT plan_code, status_code FROM wms_production_plans
       WHERE site_id = $1 AND plan_id = $2::bigint`,
      [siteId, watch.planId]
    )
    const plan = planRow.rows[0]
    if (plan) {
      const produced = qty == null ? null : Math.max(0, qty)
      if (plan.status_code !== "reserved" && produced != null && produced > 0) {
        await client.query(
          `UPDATE wms_production_plans
           SET planned_qty = $3,
               note = $4,
               updated_at = now()
           WHERE site_id = $1 AND plan_id = $2::bigint`,
          [
            siteId,
            watch.planId,
            produced,
            `Векас ${watch.batchNumber || watch.vekasBatchId}: на складе, ${produced} бут.`,
          ]
        )
      }
      await updateProductionPlanProgress(client, siteId, {
        planCode: plan.plan_code,
        percent: 100,
        doneQty: produced,
        source: `vekas:${watch.vekasServer}`,
      })
    }
  }
  await client.query(
    `UPDATE wms_vekas_aps_watches
     SET watch_state = 'completed',
         vekas_status = $3,
         produced_qty = CASE WHEN $8 THEN $4 ELSE produced_qty END,
         plan_id = COALESCE($5::bigint, plan_id),
         completed_at = COALESCE(completed_at, now()),
         started_at = COALESCE($6::timestamptz, started_at),
         finished_at = COALESCE($7::timestamptz, finished_at),
         last_polled_at = now(),
         last_error = NULL
     WHERE watch_id = $1::bigint AND site_id = $2`,
    [
      watch.watchId,
      siteId,
      status,
      qty,
      watch.planId,
      times?.startedAt?.toISOString() ?? null,
      times?.finishedAt?.toISOString() ?? null,
      qty != null,
    ]
  )
  const meta = await client.query<{
    gtin: string | null
    product_name: string | null
    production_date: string | null
  }>(
    `SELECT gtin, product_name, production_date::text
     FROM wms_vekas_aps_watches WHERE watch_id = $1::bigint`,
    [watch.watchId]
  )
  try {
    await importVekasBatchToFg(client, siteId, {
      vekasServer: watch.vekasServer,
      vekasBatchId: watch.vekasBatchId,
      batchNumber: watch.batchNumber,
      gtin: meta.rows[0]?.gtin,
      productName: meta.rows[0]?.product_name,
      productionDate: meta.rows[0]?.production_date,
      bottles: qty,
      planId: watch.planId,
      watchId: watch.watchId,
      requirePlan: true,
    })
  } catch (error) {
    console.error("importVekasBatchToFg", watch.batchNumber || watch.vekasBatchId, error)
  }
}

async function detachPlaceholderPlan(
  client: PoolClient,
  siteId: number,
  watchId: string,
  error: string
): Promise<void> {
  await client.query(
    `UPDATE wms_production_plans p
     SET status_code = 'cancelled',
         note = $3,
         updated_at = now()
     FROM wms_vekas_aps_watches w
     WHERE w.watch_id = $1::bigint
       AND w.site_id = $2
       AND p.plan_id = w.plan_id
       AND p.external_source = 'vekas'
       AND p.status_code NOT IN ('reserved', 'done')
       AND p.planned_qty = 1`,
    [watchId, siteId, error]
  )
  await client.query(
    `UPDATE wms_vekas_aps_watches w
     SET plan_id = CASE
           WHEN p.status_code = 'cancelled' AND p.planned_qty = 1 THEN NULL
           ELSE w.plan_id
         END,
         last_error = $3,
         last_polled_at = now()
     FROM wms_production_plans p
     WHERE w.watch_id = $1::bigint AND w.site_id = $2 AND p.plan_id = w.plan_id`,
    [watchId, siteId, error.slice(0, 500)]
  )
  await client.query(
    `UPDATE wms_vekas_aps_watches
     SET last_error = $3, last_polled_at = now()
     WHERE watch_id = $1::bigint AND site_id = $2 AND watch_state <> 'completed'`,
    [watchId, siteId, error.slice(0, 500)]
  )
}

async function cancelUnusedLegacyVekasPlans(client: PoolClient, siteId: number): Promise<void> {
  await client.query(
    `UPDATE wms_production_plans p
     SET status_code = 'cancelled',
         note = 'Векас: дубль без GTIN',
         updated_at = now()
     WHERE p.site_id = $1
       AND p.external_source = 'vekas'
       AND p.status_code NOT IN ('reserved', 'done', 'cancelled')
       AND p.planned_qty = 1
       AND p.external_id ~ '^(skit|slavda):[^:]+$'
       AND NOT EXISTS (
         SELECT 1 FROM wms_vekas_aps_watches w
         WHERE w.plan_id = p.plan_id AND w.watch_state = 'watching'
       )`,
    [siteId]
  )
}

async function cancelWatch(
  client: PoolClient,
  siteId: number,
  watch: { watchId: string; batchNumber: string | null; vekasBatchId: string; planId: string | null },
  status: string
): Promise<void> {
  if (watch.planId) {
    await client.query(
      `UPDATE wms_production_plans
       SET status_code = CASE WHEN status_code = 'reserved' THEN status_code ELSE 'cancelled' END,
           note = $3,
           updated_at = now()
       WHERE site_id = $1 AND plan_id = $2::bigint`,
      [siteId, watch.planId, `Векас ${watch.batchNumber || watch.vekasBatchId}: партия отменена`]
    )
  }
  await client.query(
    `UPDATE wms_vekas_aps_watches
     SET watch_state = 'skipped',
         vekas_status = $3,
         last_error = 'партия отменена в Векас',
         last_polled_at = now(),
         completed_at = now()
     WHERE watch_id = $1::bigint AND site_id = $2`,
    [watch.watchId, siteId, status]
  )
}

export async function listVekasApsWatches(
  client: PoolClient,
  siteId: number,
  opts?: { state?: "watching" | "completed" | "skipped" | "all" }
): Promise<VekasApsWatchRow[]> {
  const state = opts?.state ?? "all"
  const r = await client.query<{
    watch_id: string
    vekas_server: string
    vekas_batch_id: string
    batch_number: string | null
    vekas_status: string | null
    watch_state: string
    gtin: string | null
    product_name: string | null
    line_code: string | null
    production_date: string | null
    plan_id: string | null
    plan_code: string | null
    produced_qty: string | null
    last_error: string | null
    first_seen_at: string | null
    last_polled_at: string | null
    completed_at: string | null
    started_at: string | null
    finished_at: string | null
  }>(
    `SELECT
       w.watch_id::text,
       w.vekas_server,
       w.vekas_batch_id,
       w.batch_number,
       w.vekas_status,
       w.watch_state,
       w.gtin,
       w.product_name,
       w.line_code,
       w.production_date::text,
       w.plan_id::text,
       p.plan_code,
       w.produced_qty::text,
       w.last_error,
       w.first_seen_at::text,
       w.last_polled_at::text,
       w.completed_at::text,
       w.started_at::text,
       w.finished_at::text
     FROM wms_vekas_aps_watches w
     LEFT JOIN wms_production_plans p ON p.plan_id = w.plan_id
     WHERE w.site_id = $1
       AND ($2::text = 'all' OR w.watch_state = $2)
     ORDER BY
       CASE w.watch_state WHEN 'watching' THEN 0 WHEN 'skipped' THEN 1 ELSE 2 END,
       w.last_polled_at DESC NULLS LAST,
       w.watch_id DESC`,
    [siteId, state]
  )
  return r.rows.map((row) => ({
    watchId: row.watch_id,
    vekasServer: row.vekas_server as VekasApsServer,
    vekasBatchId: row.vekas_batch_id,
    batchNumber: row.batch_number,
    vekasStatus: row.vekas_status,
    watchState: row.watch_state as VekasApsWatchRow["watchState"],
    gtin: row.gtin,
    productName: row.product_name,
    lineCode: row.line_code,
    productionDate: row.production_date,
    planId: row.plan_id,
    planCode: row.plan_code,
    producedQty: row.produced_qty == null ? null : Number(row.produced_qty),
    lastError: row.last_error,
    firstSeenAt: row.first_seen_at,
    lastPolledAt: row.last_polled_at,
    completedAt: row.completed_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }))
}

const HISTORY_DAYS = 31
const HISTORY_IMPORT_CAP = 180
const QTY_BACKFILL_CAP = 3
const FG_BACKFILL_CAP = 40

export type VekasApsSyncOptions = {
  historyDays?: number
  historyCap?: number
  qtyBackfillCap?: number
  fgBackfillCap?: number
  importFgHistory?: boolean
  fgHistoryDays?: number
  fgHistoryCap?: number
}

async function importClosedHistory(
  client: PoolClient,
  siteId: number,
  inProcessKeys: Set<string>,
  inProcessNumbers: Set<string>,
  opts?: { historyDays?: number; historyCap?: number }
): Promise<{ imported: number; remaining: number; createdPlans: number; attachedPlans: number; skipped: number; errors: string[] }> {
  const dayFrom = shiftDayKey(todayKey(), -(opts?.historyDays ?? HISTORY_DAYS))
  const cap = opts?.historyCap ?? HISTORY_IMPORT_CAP
  const errors: string[] = []
  let imported = 0
  let createdPlans = 0
  let attachedPlans = 0
  let skipped = 0
  let remaining = 0

  for (const server of ["skit", "slavda"] as const) {
    let batches: AdapterBatch[] = []
    try {
      batches = await listRecentClosedBatches(server, dayFrom)
    } catch (error) {
      errors.push(`${server}: история — ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    for (const batch of batches) {
      const batchId = String(batch.id || "").trim()
      const batchNumber = String(batch.batchNumber || "").trim()
      if (!batchId) continue
      if (inProcessKeys.has(`${server}:${batchId}`)) continue
      if (inProcessNumbers.has(batchKey(server, batchNumber, batch.gtin, batchId))) continue

      const existing = await client.query<{
        watch_id: string
        watch_state: string
        plan_id: string | null
      }>(
        `SELECT watch_id::text, watch_state, plan_id::text
         FROM wms_vekas_aps_watches
         WHERE site_id = $1 AND vekas_server = $2 AND vekas_batch_id = $3
         LIMIT 1`,
        [siteId, server, batchId]
      )
      const watch = existing.rows[0]
      if (watch?.watch_state === "watching" && inProcessKeys.has(`${server}:${batchId}`)) continue
      if (watch?.watch_state === "completed" && watch.plan_id) {
        await persistWatchTimes(client, siteId, watch.watch_id, batch)
        continue
      }
      if (imported >= cap) {
        remaining += 1
        continue
      }
      try {
        const watchId = watch?.watch_id ?? (await upsertWatch(client, siteId, server, batch))
        await persistWatchTimes(client, siteId, watchId, batch)
        const plan = await ensurePlan(client, siteId, batch, server, { closed: true })
        if ("skipped" in plan) {
          skipped += 1
          await detachPlaceholderPlan(client, siteId, watchId, plan.skipped)
          continue
        }
        await completeWatch(
          client,
          siteId,
          {
            watchId,
            vekasServer: server,
            vekasBatchId: batchId,
            batchNumber: batchNumber || null,
            planId: plan.planId,
          },
          String(batch.status || "InStorage"),
          null,
          { startedAt: vekasStartedAt(batch), finishedAt: vekasFinishedAt(batch) ?? vekasStartedAt(batch) }
        )
        imported += 1
        if (plan.created) createdPlans += 1
        else if (plan.attached) attachedPlans += 1
      } catch (error) {
        errors.push(
          `${server} ${batchNumber || batchId}: история — ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }
  return { imported, remaining, createdPlans, attachedPlans, skipped, errors }
}

async function importFgClosedHistory(
  client: PoolClient,
  siteId: number,
  opts?: { historyDays?: number; cap?: number }
): Promise<{ imported: number; remaining: number; errors: string[] }> {
  const dayFrom = shiftDayKey(todayKey(), -(opts?.historyDays ?? 90))
  const cap = opts?.cap ?? 40
  const errors: string[] = []
  let imported = 0
  let remaining = 0
  await ensureFgVekasLotsSchema(client)

  for (const server of ["skit", "slavda"] as const) {
    let batches: AdapterBatch[] = []
    try {
      batches = await listRecentClosedBatches(server, dayFrom)
    } catch (error) {
      errors.push(`${server}: ГП история — ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    for (const batch of batches) {
      const batchId = String(batch.id || "").trim()
      if (!batchId) continue
      const exists = await client.query(
        `SELECT 1 FROM wms_fg_vekas_lots
         WHERE site_id = $1 AND vekas_server = $2 AND vekas_batch_id = $3
         LIMIT 1`,
        [siteId, server, batchId]
      )
      if (exists.rows[0]) continue
      if (imported >= cap) {
        remaining += 1
        continue
      }
      const watch = await client.query<{ plan_id: string | null; watch_id: string }>(
        `SELECT plan_id::text, watch_id::text
         FROM wms_vekas_aps_watches
         WHERE site_id = $1 AND vekas_server = $2 AND vekas_batch_id = $3
         LIMIT 1`,
        [siteId, server, batchId]
      )
      try {
        const result = await importVekasBatchToFg(client, siteId, {
          vekasServer: server,
          vekasBatchId: batchId,
          batchNumber: batch.batchNumber,
          gtin: batch.gtin,
          productName: batch.productName,
          productionDate: batch.productionDate ? dateKey(batch.productionDate) : null,
          planId: watch.rows[0]?.plan_id ?? null,
          watchId: watch.rows[0]?.watch_id ?? null,
          requirePlan: false,
        })
        if (result.imported) imported += 1
      } catch (error) {
        errors.push(
          `${server} ${batch.batchNumber || batchId}: ГП — ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }
  return { imported, remaining, errors }
}

async function backfillClosedQty(
  client: PoolClient,
  siteId: number,
  cap = QTY_BACKFILL_CAP
): Promise<{ backfilled: number; errors: string[] }> {
  const errors: string[] = []
  let backfilled = 0
  const pending = await client.query<{
    watch_id: string
    vekas_server: string
    vekas_batch_id: string
    batch_number: string | null
    plan_id: string | null
  }>(
    `SELECT watch_id::text, vekas_server, vekas_batch_id, batch_number, plan_id::text
     FROM wms_vekas_aps_watches
     WHERE site_id = $1 AND watch_state = 'completed' AND produced_qty IS NULL AND plan_id IS NOT NULL
     ORDER BY started_at DESC NULLS LAST, watch_id DESC
     LIMIT $2`,
    [siteId, cap]
  )
  for (const row of pending.rows) {
    const server = row.vekas_server as VekasApsServer
    try {
      const qty = await countProducedBottles(server, row.vekas_batch_id)
      await completeWatch(
        client,
        siteId,
        {
          watchId: row.watch_id,
          vekasServer: server,
          vekasBatchId: row.vekas_batch_id,
          batchNumber: row.batch_number,
          planId: row.plan_id,
        },
        "InStorage",
        qty
      )
      backfilled += 1
    } catch (error) {
      errors.push(
        `${server} ${row.batch_number || row.vekas_batch_id}: факт — ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  return { backfilled, errors }
}

async function backfillFgLots(
  client: PoolClient,
  siteId: number,
  cap: number
): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = []
  let imported = 0
  const pending = await client.query<{
    watch_id: string
    vekas_server: string
    vekas_batch_id: string
    batch_number: string | null
    plan_id: string | null
    gtin: string | null
    product_name: string | null
    production_date: string | null
    produced_qty: string | null
  }>(
    `SELECT w.watch_id::text, w.vekas_server, w.vekas_batch_id, w.batch_number, w.plan_id::text,
            w.gtin, w.product_name, w.production_date::text, w.produced_qty::text
     FROM wms_vekas_aps_watches w
     LEFT JOIN wms_fg_vekas_lots l
       ON l.site_id = w.site_id
      AND l.vekas_server = w.vekas_server
      AND l.vekas_batch_id = w.vekas_batch_id
     WHERE w.site_id = $1
       AND w.watch_state = 'completed'
       AND w.plan_id IS NOT NULL
       AND l.lot_row_id IS NULL
     ORDER BY w.completed_at DESC NULLS LAST, w.watch_id DESC
     LIMIT $2`,
    [siteId, cap]
  )
  for (const row of pending.rows) {
    try {
      const result = await importVekasBatchToFg(client, siteId, {
        vekasServer: row.vekas_server as VekasApsServer,
        vekasBatchId: row.vekas_batch_id,
        batchNumber: row.batch_number,
        gtin: row.gtin,
        productName: row.product_name,
        productionDate: row.production_date,
        bottles: row.produced_qty == null ? null : Number(row.produced_qty),
        planId: row.plan_id,
        watchId: row.watch_id,
        requirePlan: true,
      })
      if (result.imported) imported += 1
    } catch (error) {
      errors.push(
        `${row.vekas_server} ${row.batch_number || row.vekas_batch_id}: ГП — ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  return { imported, errors }
}

export async function syncVekasApsBatches(
  client: PoolClient,
  siteId: number,
  opts?: VekasApsSyncOptions
): Promise<VekasApsSyncResult> {
  await ensureVekasApsSchema(client)
  const errors: string[] = []
  let listed = 0
  let createdPlans = 0
  let attachedPlans = 0
  let completed = 0
  let skipped = 0
  const inProcessKeys = new Set<string>()
  const inProcessNumbers = new Set<string>()

  for (const server of ["skit", "slavda"] as const) {
    let batches: AdapterBatch[] = []
    try {
      batches = await listInProcessBatches(server)
    } catch (error) {
      errors.push(`${server}: список в процессе — ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    listed += batches.length
    for (const batch of batches) {
      const batchId = String(batch.id || "").trim()
      const batchNumber = String(batch.batchNumber || "").trim()
      if (batchId) inProcessKeys.add(`${server}:${batchId}`)
      inProcessNumbers.add(batchKey(server, batchNumber, batch.gtin, batchId))
      try {
        const watchId = await upsertWatch(client, siteId, server, batch)
        const state = await client.query<{ watch_state: string }>(
          `SELECT watch_state FROM wms_vekas_aps_watches WHERE watch_id = $1::bigint`,
          [watchId]
        )
        if (state.rows[0]?.watch_state === "completed") {
          await client.query(
            `UPDATE wms_vekas_aps_watches
             SET watch_state = 'watching',
                 completed_at = NULL,
                 finished_at = NULL,
                 produced_qty = NULL,
                 last_error = NULL,
                 last_polled_at = now()
             WHERE watch_id = $1::bigint AND site_id = $2`,
            [watchId, siteId]
          )
          await client.query(
            `UPDATE wms_production_plans p
             SET status_code = 'in_progress',
                 actual_percent = 0,
                 actual_qty = NULL,
                 note = 'Векас: снова в процессе, факт после статуса «На складе»',
                 updated_at = now()
             FROM wms_vekas_aps_watches w
             WHERE w.watch_id = $1::bigint
               AND w.site_id = $2
               AND p.plan_id = w.plan_id
               AND p.status_code <> 'reserved'`,
            [watchId, siteId]
          )
        }
        const plan = await ensurePlan(client, siteId, batch, server)
        if ("skipped" in plan) {
          skipped += 1
          await detachPlaceholderPlan(client, siteId, watchId, plan.skipped)
          continue
        }
        await client.query(
          `UPDATE wms_vekas_aps_watches
           SET plan_id = $3::bigint, watch_state = 'watching', last_error = NULL, last_polled_at = now()
           WHERE watch_id = $1::bigint AND site_id = $2`,
          [watchId, siteId, plan.planId]
        )
        if (plan.created) createdPlans += 1
        else if (plan.attached) attachedPlans += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${server} ${batch.batchNumber || batch.id}: ${message}`)
        await client.query(
          `UPDATE wms_vekas_aps_watches
           SET last_error = $3, last_polled_at = now()
           WHERE site_id = $1 AND vekas_server = $2 AND vekas_batch_id = $4 AND watch_state <> 'completed'`,
          [siteId, server, message.slice(0, 500), String(batch.id || "").trim()]
        )
      }
    }
  }

  const open = await client.query<{
    watch_id: string
    vekas_server: string
    vekas_batch_id: string
    batch_number: string | null
    plan_id: string | null
    gtin: string | null
    product_name: string | null
    line_code: string | null
    production_date: string | null
  }>(
    `SELECT watch_id::text, vekas_server, vekas_batch_id, batch_number, plan_id::text,
            gtin, product_name, line_code, production_date::text
     FROM wms_vekas_aps_watches
     WHERE site_id = $1 AND watch_state = 'watching'`,
    [siteId]
  )

  for (const watch of open.rows) {
    const server = watch.vekas_server as VekasApsServer
    try {
      const live = await loadBatch(server, watch.vekas_batch_id, watch.batch_number)
      const status = String(live?.status || "").trim()
      await client.query(
        `UPDATE wms_vekas_aps_watches
         SET vekas_status = COALESCE(NULLIF($3, ''), vekas_status),
             last_polled_at = now()
         WHERE watch_id = $1::bigint AND site_id = $2`,
        [watch.watch_id, siteId, status]
      )
      if (live) await persistWatchTimes(client, siteId, watch.watch_id, live)
      if (!status || isInProcess(status)) continue
      if (inProcessKeys.has(`${server}:${watch.vekas_batch_id}`)) continue
      if (inProcessNumbers.has(batchKey(server, watch.batch_number, watch.gtin, watch.vekas_batch_id))) {
        await client.query(
          `UPDATE wms_vekas_aps_watches
           SET watch_state = 'skipped',
               last_error = 'та же партия снова в производстве под новым id',
               last_polled_at = now()
           WHERE watch_id = $1::bigint AND site_id = $2 AND watch_state = 'watching'`,
          [watch.watch_id, siteId]
        )
        continue
      }
      if (isCancelledStatus(status)) {
        await cancelWatch(
          client,
          siteId,
          {
            watchId: watch.watch_id,
            batchNumber: watch.batch_number,
            vekasBatchId: watch.vekas_batch_id,
            planId: watch.plan_id,
          },
          status
        )
        skipped += 1
        continue
      }
      if (!isDoneStatus(status)) continue
      let planId = watch.plan_id
      if (!planId) {
        const plan = await ensurePlan(client, siteId, live ?? {
          id: watch.vekas_batch_id,
          batchNumber: watch.batch_number,
          status,
          gtin: watch.gtin,
          productName: watch.product_name,
          productLineName: watch.line_code,
          productionDate: watch.production_date,
        }, server)
        if ("skipped" in plan) {
          skipped += 1
          await detachPlaceholderPlan(client, siteId, watch.watch_id, plan.skipped)
        } else {
          planId = plan.planId
          if (plan.created) createdPlans += 1
          else if (plan.attached) attachedPlans += 1
        }
      }
      const qty = await countProducedBottles(server, watch.vekas_batch_id)
      await completeWatch(
        client,
        siteId,
        {
          watchId: watch.watch_id,
          vekasServer: server,
          vekasBatchId: watch.vekas_batch_id,
          batchNumber: watch.batch_number,
          planId,
        },
        status,
        qty,
        live
          ? { startedAt: vekasStartedAt(live), finishedAt: vekasFinishedAt(live) }
          : undefined
      )
      if (planId && live) {
        const dates = planDatesFromBatch({ ...live, status })
        const planMeta = await client.query<{ plan_code: string; status_code: string }>(
          `SELECT plan_code, status_code FROM wms_production_plans WHERE site_id = $1 AND plan_id = $2::bigint`,
          [siteId, planId]
        )
        if (planMeta.rows[0] && planMeta.rows[0].status_code !== "reserved") {
          try {
            await updateProductionPlan(client, siteId, planMeta.rows[0].plan_code, {
              planDate: dates.planDate,
              planDateTo: dates.planDateTo,
              syncCalendar: true,
            })
          } catch {
            /* reserved or concurrent edit */
          }
        }
      }
      if (!planId) {
        await client.query(
          `UPDATE wms_vekas_aps_watches
           SET last_error = $3
           WHERE watch_id = $1::bigint AND site_id = $2`,
          [watch.watch_id, siteId, `факт ${qty} бут., номенклатура по GTIN не найдена`]
        )
      }
      completed += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${server} ${watch.batch_number || watch.vekas_batch_id}: ${message}`)
      await client.query(
        `UPDATE wms_vekas_aps_watches
         SET last_error = $3, last_polled_at = now()
         WHERE watch_id = $1::bigint AND site_id = $2`,
        [watch.watch_id, siteId, message.slice(0, 500)]
      )
    }
  }

  const orphans = await client.query<{
    watch_id: string
    vekas_server: string
    vekas_batch_id: string
    batch_number: string | null
    vekas_status: string | null
    gtin: string | null
    product_name: string | null
    line_code: string | null
    production_date: string | null
    produced_qty: string | null
  }>(
    `SELECT watch_id::text, vekas_server, vekas_batch_id, batch_number, vekas_status,
            gtin, product_name, line_code, production_date::text, produced_qty::text
     FROM wms_vekas_aps_watches
     WHERE site_id = $1 AND watch_state = 'completed' AND plan_id IS NULL AND produced_qty IS NOT NULL
       AND NOT (vekas_server || ':' || vekas_batch_id) = ANY($2::text[])`,
    [siteId, [...inProcessKeys]]
  )
  for (const watch of orphans.rows) {
    const server = watch.vekas_server as VekasApsServer
    const liveTwin = await client.query(
      `SELECT 1 FROM wms_vekas_aps_watches
       WHERE site_id = $1 AND vekas_server = $2 AND batch_number = $3
         AND COALESCE(gtin, '') = COALESCE($4, '')
         AND watch_state = 'watching'
       LIMIT 1`,
      [siteId, server, watch.batch_number, watch.gtin]
    )
    if (liveTwin.rows[0]) continue
    try {
      const plan = await ensurePlan(
        client,
        siteId,
        {
          id: watch.vekas_batch_id,
          batchNumber: watch.batch_number,
          status: watch.vekas_status,
          gtin: watch.gtin,
          productName: watch.product_name,
          productLineName: watch.line_code,
          productionDate: watch.production_date,
        },
        server
      )
      if ("skipped" in plan) {
        skipped += 1
        await client.query(
          `UPDATE wms_vekas_aps_watches SET last_error = $3 WHERE watch_id = $1::bigint AND site_id = $2`,
          [watch.watch_id, siteId, plan.skipped]
        )
        continue
      }
      await completeWatch(
        client,
        siteId,
        {
          watchId: watch.watch_id,
          vekasServer: server,
          vekasBatchId: watch.vekas_batch_id,
          batchNumber: watch.batch_number,
          planId: plan.planId,
        },
        watch.vekas_status || "InStorage",
        Number(watch.produced_qty || 0)
      )
      if (plan.created) createdPlans += 1
      else if (plan.attached) attachedPlans += 1
    } catch (error) {
      errors.push(
        `${server} ${watch.batch_number || watch.vekas_batch_id}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const history = await importClosedHistory(client, siteId, inProcessKeys, inProcessNumbers, {
    historyDays: opts?.historyDays,
    historyCap: opts?.historyCap,
  })
  createdPlans += history.createdPlans
  attachedPlans += history.attachedPlans
  skipped += history.skipped
  errors.push(...history.errors)
  const qtyFill = await backfillClosedQty(client, siteId, opts?.qtyBackfillCap)
  errors.push(...qtyFill.errors)
  let fgImported = 0
  let fgHistoryRemaining = 0
  if (opts?.importFgHistory) {
    const fgHistory = await importFgClosedHistory(client, siteId, {
      historyDays: opts.fgHistoryDays ?? opts.historyDays ?? 90,
      cap: opts.fgHistoryCap ?? opts.fgBackfillCap ?? FG_BACKFILL_CAP,
    })
    fgImported += fgHistory.imported
    fgHistoryRemaining = fgHistory.remaining
    errors.push(...fgHistory.errors)
  }
  const fgFill = await backfillFgLots(client, siteId, opts?.fgBackfillCap ?? FG_BACKFILL_CAP)
  fgImported += fgFill.imported
  errors.push(...fgFill.errors)

  await cancelUnusedLegacyVekasPlans(client, siteId)

  const missingTimes = await client.query<{
    watch_id: string
    vekas_server: string
    vekas_batch_id: string
    batch_number: string | null
  }>(
    `SELECT watch_id::text, vekas_server, vekas_batch_id, batch_number
     FROM wms_vekas_aps_watches
     WHERE site_id = $1 AND started_at IS NULL
     ORDER BY watch_id DESC
     LIMIT 30`,
    [siteId]
  )
  for (const row of missingTimes.rows) {
    try {
      const live = await loadBatch(row.vekas_server as VekasApsServer, row.vekas_batch_id, row.batch_number)
      if (live) await persistWatchTimes(client, siteId, row.watch_id, live)
    } catch (error) {
      errors.push(
        `${row.vekas_server} ${row.batch_number || row.vekas_batch_id}: время — ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const watches = await listVekasApsWatches(client, siteId, { state: "all" })
  return {
    listed,
    watching: watches.filter((w) => w.watchState === "watching").length,
    createdPlans,
    attachedPlans,
    completed,
    skipped,
    historyImported: history.imported,
    historyRemaining: history.remaining,
    qtyBackfilled: qtyFill.backfilled,
    fgImported,
    fgHistoryRemaining,
    errors,
    watches,
  }
}
