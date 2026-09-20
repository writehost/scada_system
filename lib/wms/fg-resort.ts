import type { PoolClient } from "pg"
import { createDocumentWithTasks } from "@/lib/wms/documents"
import { WmsHttpError } from "@/lib/wms/errors"
import type { FgItemStatuses, FgMarkingNode, FgNomenclatureRow, FgPalletRow } from "@/lib/wms/finished-goods-types"

export const FG_RESORT_REASONS = ["extra_physical", "extra_system", "other"] as const
export type FgResortReason = (typeof FG_RESORT_REASONS)[number]
export type FgResortStatus = "open" | "in_progress" | "done" | "cancelled"
export type FgResortOutcome = "confirmed" | "found_extra" | "found_missing"

export const FG_RESORT_REASON_LABEL: Record<FgResortReason, string> = {
  extra_physical: "На палете есть упаковки, которых нет в программе",
  extra_system: "В программе больше, чем физически на палете",
  other: "Другая причина",
}

export const FG_RESORT_OUTCOME_LABEL: Record<FgResortOutcome, string> = {
  confirmed: "Состав совпал с программой",
  found_extra: "Нашли лишние упаковки",
  found_missing: "Не досчитались упаковок",
}

export type FgResortJob = {
  jobId: string
  palletId: string
  palletCode: string
  itemCode: string
  itemName: string
  locationCode: string
  rowLabel: string
  bottles: number
  reason: FgResortReason
  reasonLabel: string
  comment: string | null
  status: FgResortStatus
  documentId: string | null
  taskId: string | null
  createdBy: string
  createdAt: string
  completedAt: string | null
  completedBy: string | null
  completeNote: string | null
  outcome: FgResortOutcome | null
}

export type FgResortIndex = {
  palletIds: Set<string>
  itemCodes: Set<string>
}

let schemaReady = false

export async function ensureFgResortSchema(client: PoolClient): Promise<void> {
  if (schemaReady) return
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_resort_jobs (
      job_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      pallet_code_id BIGINT NOT NULL,
      pallet_code TEXT NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT,
      location_code TEXT,
      row_label TEXT,
      bottles INT NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      document_id BIGINT,
      task_id BIGINT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      completed_by TEXT,
      complete_note TEXT,
      outcome TEXT
    )`)
  await client.query(`
    CREATE INDEX IF NOT EXISTS wms_fg_resort_jobs_site_status_idx
      ON wms_fg_resort_jobs (site_id, status, created_at DESC)`)
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS wms_fg_resort_jobs_open_pallet_idx
      ON wms_fg_resort_jobs (site_id, pallet_code_id)
      WHERE status IN ('open', 'in_progress')`)
  schemaReady = true
}

function isReason(value: string): value is FgResortReason {
  return (FG_RESORT_REASONS as readonly string[]).includes(value)
}

function isOutcome(value: string): value is FgResortOutcome {
  return value === "confirmed" || value === "found_extra" || value === "found_missing"
}

function mapJob(row: {
  jobId: string
  palletId: string
  palletCode: string
  itemCode: string
  itemName: string | null
  locationCode: string | null
  rowLabel: string | null
  bottles: string | number | null
  reason: string
  comment: string | null
  status: string
  documentId: string | null
  taskId: string | null
  createdBy: string | null
  createdAt: string
  completedAt: string | null
  completedBy: string | null
  completeNote: string | null
  outcome: string | null
}): FgResortJob {
  const reason = isReason(row.reason) ? row.reason : "other"
  const outcome = row.outcome && isOutcome(row.outcome) ? row.outcome : null
  return {
    jobId: row.jobId,
    palletId: row.palletId,
    palletCode: row.palletCode,
    itemCode: row.itemCode,
    itemName: row.itemName || "—",
    locationCode: row.locationCode || "—",
    rowLabel: row.rowLabel || row.locationCode || "—",
    bottles: Number(row.bottles) || 0,
    reason,
    reasonLabel: FG_RESORT_REASON_LABEL[reason],
    comment: row.comment,
    status: (row.status as FgResortStatus) || "open",
    documentId: row.documentId,
    taskId: row.taskId,
    createdBy: row.createdBy || "оператор",
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    completedBy: row.completedBy,
    completeNote: row.completeNote,
    outcome,
  }
}

const JOB_SELECT = `
  job_id::text AS "jobId",
  pallet_code_id::text AS "palletId",
  pallet_code AS "palletCode",
  item_code AS "itemCode",
  item_name AS "itemName",
  location_code AS "locationCode",
  row_label AS "rowLabel",
  bottles,
  reason,
  comment,
  status,
  document_id::text AS "documentId",
  task_id::text AS "taskId",
  created_by AS "createdBy",
  created_at::text AS "createdAt",
  completed_at::text AS "completedAt",
  completed_by AS "completedBy",
  complete_note AS "completeNote",
  outcome
`

export async function listOpenResortIndex(client: PoolClient, siteId: number): Promise<FgResortIndex> {
  await ensureFgResortSchema(client)
  const r = await client.query<{ palletId: string; itemCode: string }>(
    `SELECT pallet_code_id::text AS "palletId", item_code AS "itemCode"
     FROM wms_fg_resort_jobs
     WHERE site_id = $1 AND status IN ('open', 'in_progress')`,
    [siteId]
  )
  return {
    palletIds: new Set(r.rows.map((row) => row.palletId)),
    itemCodes: new Set(r.rows.map((row) => row.itemCode)),
  }
}

export function applyResortToItem(row: FgNomenclatureRow, openItems: Set<string>): FgNomenclatureRow {
  if (!openItems.has(row.itemCode)) return row
  const tags = row.tags.includes("resort") ? row.tags : [...row.tags, "resort" as const]
  return {
    ...row,
    tags,
    statuses: { ...row.statuses, onResort: true },
  }
}

export function applyResortToPallet(row: FgPalletRow, openPallets: Set<string>): FgPalletRow {
  if (!row.palletId || !openPallets.has(row.palletId)) return row
  const tags = row.tags.includes("resort") ? row.tags : [...row.tags, "resort" as const]
  return {
    ...row,
    tags,
    statuses: { ...row.statuses, onResort: true },
  }
}

export function applyResortToNode(node: FgMarkingNode, openPallets: Set<string>): FgMarkingNode {
  if (!openPallets.has(node.id)) return node
  const tags = node.tags.includes("resort") ? node.tags : [...node.tags, "resort" as const]
  return { ...node, tags }
}

export function withResortStatus(statuses: FgItemStatuses, onResort: boolean): FgItemStatuses {
  return onResort ? { ...statuses, onResort: true } : statuses
}

type ResolvedPallet = {
  palletId: string
  palletCode: string
  itemCode: string
  itemName: string
  locationCode: string
  rowLabel: string
  bottles: number
}

async function resolvePallets(
  client: PoolClient,
  siteId: number,
  palletIds: string[]
): Promise<ResolvedPallet[]> {
  const ids = [...new Set(palletIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return []
  const r = await client.query<{
    palletId: string
    palletCode: string
    itemCode: string | null
    itemName: string | null
    locationCode: string | null
    rowLabel: string | null
    bottles: string
  }>(
    `
    SELECT
      c.code_id::text AS "palletId",
      (c.ai01_gtin || COALESCE(c.ai21_serial, '')) AS "palletCode",
      i.item_code AS "itemCode",
      i.name AS "itemName",
      COALESCE(l.location_code, '') AS "locationCode",
      COALESCE(NULLIF(l.display_name, ''), l.location_code, '') AS "rowLabel",
      (
        SELECT COUNT(*)::text
        FROM codes u
        JOIN codes b ON b.code_id = u.parent_code_id
        WHERE b.parent_code_id = c.code_id
      ) AS bottles
    FROM codes c
    LEFT JOIN wms_item_codes mic
      ON mic.code_id = c.code_id AND mic.unlinked_at IS NULL AND mic.current_site_id = $2
    LEFT JOIN wms_items i ON i.item_id = mic.item_id
    LEFT JOIN wms_locations l ON l.location_id = mic.current_location_id
    WHERE c.code_id = ANY($1::bigint[])
    `,
    [ids, siteId]
  )
  return r.rows.map((row) => ({
    palletId: row.palletId,
    palletCode: row.palletCode,
    itemCode: row.itemCode || "",
    itemName: row.itemName || "—",
    locationCode: row.locationCode || "",
    rowLabel: row.rowLabel || row.locationCode || "",
    bottles: Number(row.bottles) || 0,
  }))
}

async function createResortDocument(
  client: PoolClient,
  siteId: number,
  siteCode: string,
  requestId: string,
  reason: FgResortReason,
  comment: string | null,
  pallets: ResolvedPallet[],
  createdBy: string
): Promise<{ documentId: string | null; taskIds: Map<string, string> }> {
  const lines = pallets
    .filter((p) => p.itemCode)
    .map((p) => ({
      itemCode: p.itemCode,
      qty: Math.max(1, p.bottles),
      sourceLocationCode: p.locationCode || undefined,
      loadUnitCode: p.palletCode || undefined,
      loadUnitType: "pallet",
      comment: `Перебор палеты ${p.palletCode.slice(-12)}`,
      taskPayload: {
        kind: "fg_resort",
        palletCodeId: p.palletId,
        palletCode: p.palletCode,
        reason,
        reasonLabel: FG_RESORT_REASON_LABEL[reason],
      },
    }))
  if (lines.length === 0) return { documentId: null, taskIds: new Map() }

  const created = await createDocumentWithTasks(client, siteId, {
    requestId,
    siteCode,
    documentType: "revision",
    sourceLocationCode: pallets.find((p) => p.locationCode)?.locationCode || undefined,
    priorityCode: "high",
    documentNo: `FG-RESORT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    comment: [
      "Перебор готовой продукции",
      FG_RESORT_REASON_LABEL[reason],
      comment,
      `инициатор: ${createdBy}`,
    ]
      .filter(Boolean)
      .join(" · "),
    lines,
  })

  const taskIds = new Map<string, string>()
  const linked = pallets.filter((p) => p.itemCode)
  linked.forEach((pallet, index) => {
    const id = created.createdLines[index]?.taskId
    if (id) taskIds.set(pallet.palletId, String(id))
  })
  return { documentId: created.documentId ?? null, taskIds }
}

export async function sendPalletsToResort(
  client: PoolClient,
  siteId: number,
  input: {
    siteCode: string
    requestId: string
    palletIds: string[]
    reason: FgResortReason
    comment?: string | null
    createdBy: string
  }
): Promise<{ created: FgResortJob[]; skipped: number; documentId: string | null }> {
  await ensureFgResortSchema(client)
  const pallets = await resolvePallets(client, siteId, input.palletIds)
  if (pallets.length === 0) {
    throw new WmsHttpError(404, "Палеты не найдены", "pallet_not_found")
  }
  const missing = pallets.filter((p) => !p.itemCode)
  if (missing.length === pallets.length) {
    throw new WmsHttpError(400, "У выбранных палет нет номенклатуры на складе ГП", "pallet_not_linked")
  }

  const open = await listOpenResortIndex(client, siteId)
  const fresh = pallets.filter((p) => p.itemCode && !open.palletIds.has(p.palletId))
  const skipped = pallets.length - fresh.length
  if (fresh.length === 0) {
    return { created: [], skipped, documentId: null }
  }

  let documentId: string | null = null
  let taskIds = new Map<string, string>()
  try {
    const doc = await createResortDocument(
      client,
      siteId,
      input.siteCode,
      input.requestId,
      input.reason,
      input.comment ?? null,
      fresh,
      input.createdBy
    )
    documentId = doc.documentId
    taskIds = doc.taskIds
  } catch (error) {
    console.error("[fg-resort] document", error)
  }

  const created: FgResortJob[] = []
  for (const pallet of fresh) {
    const inserted = await client.query({
      text: `
        INSERT INTO wms_fg_resort_jobs (
          site_id, pallet_code_id, pallet_code, item_code, item_name,
          location_code, row_label, bottles, reason, comment, status,
          document_id, task_id, created_by
        ) VALUES (
          $1, $2::bigint, $3, $4, $5,
          $6, $7, $8, $9, $10, 'open',
          $11::bigint, $12::bigint, $13
        )
        ON CONFLICT (site_id, pallet_code_id) WHERE status IN ('open', 'in_progress') DO NOTHING
        RETURNING ${JOB_SELECT}
      `,
      values: [
        siteId,
        pallet.palletId,
        pallet.palletCode,
        pallet.itemCode,
        pallet.itemName,
        pallet.locationCode,
        pallet.rowLabel,
        pallet.bottles,
        input.reason,
        input.comment ?? null,
        documentId,
        taskIds.get(pallet.palletId) ?? null,
        input.createdBy,
      ],
    })
    if (inserted.rows[0]) created.push(mapJob(inserted.rows[0]))
  }
  return { created, skipped: skipped + (fresh.length - created.length), documentId }
}

export async function listResortJobs(
  client: PoolClient,
  siteId: number,
  status: "open" | "done" | "all" = "open"
): Promise<FgResortJob[]> {
  await ensureFgResortSchema(client)
  const r = await client.query(
    `
    SELECT ${JOB_SELECT}
    FROM wms_fg_resort_jobs
    WHERE site_id = $1
      AND (
        $2 = 'all'
        OR ($2 = 'open' AND status IN ('open', 'in_progress'))
        OR ($2 = 'done' AND status IN ('done', 'cancelled'))
      )
    ORDER BY
      CASE WHEN status IN ('open', 'in_progress') THEN 0 ELSE 1 END,
      created_at DESC
    LIMIT 200
    `,
    [siteId, status]
  )
  return r.rows.map(mapJob)
}

export async function completeResortJob(
  client: PoolClient,
  siteId: number,
  jobId: string,
  input: { completedBy: string; note?: string | null; outcome: FgResortOutcome }
): Promise<FgResortJob> {
  await ensureFgResortSchema(client)
  const r = await client.query(
    `
    UPDATE wms_fg_resort_jobs
    SET status = 'done',
        completed_at = now(),
        completed_by = $3,
        complete_note = $4,
        outcome = $5
    WHERE site_id = $1 AND job_id = $2::bigint AND status IN ('open', 'in_progress')
    RETURNING ${JOB_SELECT}
    `,
    [siteId, jobId, input.completedBy, input.note ?? null, input.outcome]
  )
  if (!r.rows[0]) {
    throw new WmsHttpError(404, "Заявка на перебор не найдена или уже закрыта", "resort_not_found")
  }
  const job = mapJob(r.rows[0])
  if (job.taskId) {
    await client.query(
      `UPDATE wms_tasks
       SET task_status_id = 4, completed_at = now(), confirmed_qty = GREATEST(planned_qty, 1)
       WHERE task_id = $1::bigint AND site_id = $2 AND completed_at IS NULL`,
      [job.taskId, siteId]
    )
  }
  return job
}

export async function cancelResortJob(
  client: PoolClient,
  siteId: number,
  jobId: string,
  input: { completedBy: string; note?: string | null }
): Promise<FgResortJob> {
  await ensureFgResortSchema(client)
  const r = await client.query(
    `
    UPDATE wms_fg_resort_jobs
    SET status = 'cancelled',
        completed_at = now(),
        completed_by = $3,
        complete_note = $4
    WHERE site_id = $1 AND job_id = $2::bigint AND status IN ('open', 'in_progress')
    RETURNING ${JOB_SELECT}
    `,
    [siteId, jobId, input.completedBy, input.note ?? null]
  )
  if (!r.rows[0]) {
    throw new WmsHttpError(404, "Заявка на перебор не найдена или уже закрыта", "resort_not_found")
  }
  const job = mapJob(r.rows[0])
  if (job.taskId) {
    await client.query(
      `UPDATE wms_tasks
       SET task_status_id = 5, completed_at = now()
       WHERE task_id = $1::bigint AND site_id = $2 AND completed_at IS NULL`,
      [job.taskId, siteId]
    )
  }
  return job
}
