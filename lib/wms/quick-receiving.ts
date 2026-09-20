import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"
import { getSiteId, resolveItemByCodeOrBarcode } from "@/lib/wms/resolve"

export const QUICK_LPN_STATUSES = [
  "CREATED",
  "WAITING_PRINT",
  "PRINTING",
  "PRINTED",
  "WAITING_VERIFICATION",
  "VERIFIED",
  "READY_FOR_PUTAWAY",
  "STORED",
  "PRINT_ERROR",
  "VERIFICATION_ERROR",
  "BLOCKED",
  "CANCELLED",
] as const

export type QuickLpnStatus = (typeof QUICK_LPN_STATUSES)[number]

export type QuickReceivingMode = "sequential" | "batch"

export type QuickLpnRow = {
  lpnId: string
  lpnCode: string
  itemCode: string
  itemName: string
  lotCode: string
  qty: number
  productionDate: string | null
  expiryDate: string | null
  status: QuickLpnStatus
  printedAt: string | null
  verifiedAt: string | null
  reprintCount: number
  lastError: string | null
}

export type QuickReceivingRow = {
  receivingId: string
  number: string
  supplier: string
  documentNumber: string
  status: "open" | "completed" | "cancelled"
  mode: QuickReceivingMode
  createdBy: string
  createdAt: string
  completedAt: string | null
  itemCode: string
  itemName: string
  lotCode: string
  productionDate: string | null
  expiryDate: string | null
  palletCount: number
  qtyPerLpn: number
  totalQty: number
  progress: {
    total: number
    printed: number
    verified: number
    waitingPrint: number
    waitingScan: number
    errors: number
    cancelled: number
  }
  lpns: QuickLpnRow[]
}

export function addShelfLife(productionDate: string, shelfLifeDays: number): string {
  const d = new Date(`${productionDate}T00:00:00`)
  if (Number.isNaN(d.getTime()) || !Number.isFinite(shelfLifeDays)) return ""
  d.setDate(d.getDate() + Math.trunc(shelfLifeDays))
  return d.toISOString().slice(0, 10)
}

/** 11.09.2026 + 24 месяца → 11.09.2028 */
export function addShelfLifeMonths(productionDate: string, months: number): string {
  const d = new Date(`${productionDate}T00:00:00`)
  if (Number.isNaN(d.getTime()) || !Number.isFinite(months)) return ""
  d.setMonth(d.getMonth() + Math.trunc(months))
  return d.toISOString().slice(0, 10)
}

export function decideVerify(input: {
  scanned: string
  receivingId: string
  sequential: boolean
  expectedCode: string | null
  lpn: {
    lpnCode: string
    receivingId: string
    status: QuickLpnStatus
  } | null
}): { ok: true; nextHint?: string } | { ok: false; code: string; message: string } {
  const scanned = input.scanned.trim().toUpperCase()
  if (!scanned) return { ok: false, code: "empty", message: "Пустой код" }
  if (!input.lpn) return { ok: false, code: "unknown", message: "Неизвестный стикер" }
  if (input.lpn.receivingId !== input.receivingId) {
    return { ok: false, code: "wrong_receiving", message: "Стикер из другой приёмки" }
  }
  if (input.lpn.status === "CANCELLED") {
    return { ok: false, code: "cancelled", message: "Стикер аннулирован" }
  }
  if (input.lpn.status === "VERIFIED" || input.lpn.status === "READY_FOR_PUTAWAY" || input.lpn.status === "STORED") {
    return { ok: false, code: "already_verified", message: "Этот стикер уже подтверждён" }
  }
  if (input.lpn.status === "WAITING_PRINT" || input.lpn.status === "CREATED" || input.lpn.status === "PRINTING") {
    return { ok: false, code: "not_printed", message: "Стикер ещё не напечатан" }
  }
  if (input.sequential && input.expectedCode && scanned !== input.expectedCode.toUpperCase()) {
    return {
      ok: false,
      code: "wrong_sticker",
      message: `Отсканирован другой стикер. Ожидался ${input.expectedCode}, получен ${scanned}`,
    }
  }
  if (scanned !== input.lpn.lpnCode.toUpperCase()) {
    return { ok: false, code: "mismatch", message: "Код не совпадает с LPN" }
  }
  if (input.lpn.status !== "WAITING_VERIFICATION" && input.lpn.status !== "PRINTED" && input.lpn.status !== "VERIFICATION_ERROR") {
    return { ok: false, code: "bad_status", message: `Нельзя подтвердить статус ${input.lpn.status}` }
  }
  return { ok: true }
}

export async function ensureQuickReceivingSchema(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_quick_receivings (
      receiving_id bigserial PRIMARY KEY,
      site_id integer NOT NULL,
      number text NOT NULL,
      supplier text NOT NULL DEFAULT '',
      document_number text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'open',
      mode text NOT NULL DEFAULT 'sequential',
      item_code text NOT NULL,
      item_name text NOT NULL,
      lot_code text NOT NULL,
      production_date date,
      expiry_date date,
      pallet_count integer NOT NULL,
      qty_per_lpn numeric NOT NULL,
      total_qty numeric NOT NULL,
      created_by text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      completed_at timestamptz,
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `)
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_wms_quick_receivings_site_number
      ON wms_quick_receivings (site_id, number)
  `)
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_quick_lpns (
      lpn_id bigserial PRIMARY KEY,
      site_id integer NOT NULL,
      receiving_id bigint NOT NULL REFERENCES wms_quick_receivings(receiving_id) ON DELETE CASCADE,
      lpn_code text NOT NULL,
      item_code text NOT NULL,
      item_name text NOT NULL,
      lot_code text NOT NULL,
      qty numeric NOT NULL,
      production_date date,
      expiry_date date,
      status text NOT NULL DEFAULT 'WAITING_PRINT',
      printed_at timestamptz,
      verified_at timestamptz,
      reprint_count integer NOT NULL DEFAULT 0,
      last_error text,
      cancelled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `)
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_wms_quick_lpns_site_code
      ON wms_quick_lpns (site_id, lpn_code)
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_wms_quick_lpns_receiving
      ON wms_quick_lpns (receiving_id, status)
  `)
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_quick_lpn_events (
      event_id bigserial PRIMARY KEY,
      receiving_id bigint NOT NULL,
      lpn_id bigint,
      kind text NOT NULL,
      actor text NOT NULL DEFAULT '',
      device text NOT NULL DEFAULT '',
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

function pad(n: number, width: number) {
  return String(n).padStart(width, "0")
}

function dayKey(d = new Date()) {
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1, 2)
  const day = pad(d.getDate(), 2)
  return `${y}${m}${day}`
}

async function nextNumber(client: PoolClient, siteId: number, prefix: string, width = 4): Promise<string> {
  const key = dayKey()
  const like = `${prefix}-${key}-%`
  const r = await client.query<{ n: string }>(
    prefix === "QR"
      ? `SELECT number AS n FROM wms_quick_receivings WHERE site_id = $1 AND number LIKE $2 ORDER BY number DESC LIMIT 1`
      : `SELECT lpn_code AS n FROM wms_quick_lpns WHERE site_id = $1 AND lpn_code LIKE $2 ORDER BY lpn_code DESC LIMIT 1`,
    [siteId, like]
  )
  const last = r.rows[0]?.n ?? ""
  const seq = Number(last.split("-").pop() || "0") + 1
  return `${prefix}-${key}-${pad(seq, width)}`
}

function mapLpn(row: Record<string, unknown>): QuickLpnRow {
  return {
    lpnId: String(row.lpn_id),
    lpnCode: String(row.lpn_code),
    itemCode: String(row.item_code),
    itemName: String(row.item_name),
    lotCode: String(row.lot_code),
    qty: Number(row.qty),
    productionDate: row.production_date ? String(row.production_date).slice(0, 10) : null,
    expiryDate: row.expiry_date ? String(row.expiry_date).slice(0, 10) : null,
    status: String(row.status) as QuickLpnStatus,
    printedAt: row.printed_at ? String(row.printed_at) : null,
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    reprintCount: Number(row.reprint_count || 0),
    lastError: row.last_error ? String(row.last_error) : null,
  }
}

function progressOf(lpns: QuickLpnRow[]) {
  const active = lpns.filter((l) => l.status !== "CANCELLED")
  return {
    total: active.length,
    printed: active.filter((l) =>
      ["PRINTED", "WAITING_VERIFICATION", "VERIFIED", "READY_FOR_PUTAWAY", "STORED"].includes(l.status)
    ).length,
    verified: active.filter((l) => ["VERIFIED", "READY_FOR_PUTAWAY", "STORED"].includes(l.status)).length,
    waitingPrint: active.filter((l) => ["CREATED", "WAITING_PRINT", "PRINTING", "PRINT_ERROR"].includes(l.status)).length,
    waitingScan: active.filter((l) => ["PRINTED", "WAITING_VERIFICATION", "VERIFICATION_ERROR"].includes(l.status)).length,
    errors: active.filter((l) => l.status === "PRINT_ERROR" || l.status === "VERIFICATION_ERROR").length,
    cancelled: lpns.filter((l) => l.status === "CANCELLED").length,
  }
}

async function loadReceiving(client: PoolClient, siteId: number, receivingId: string): Promise<QuickReceivingRow> {
  const header = await client.query(
    `SELECT * FROM wms_quick_receivings WHERE site_id = $1 AND receiving_id = $2::bigint`,
    [siteId, receivingId]
  )
  const rec = header.rows[0]
  if (!rec) throw new WmsHttpError(404, "Приёмка не найдена", "not_found")
  const lpns = await client.query(
    `SELECT * FROM wms_quick_lpns WHERE receiving_id = $1::bigint ORDER BY lpn_code`,
    [receivingId]
  )
  const mapped = lpns.rows.map((row) => mapLpn(row as Record<string, unknown>))
  return {
    receivingId: String(rec.receiving_id),
    number: rec.number,
    supplier: rec.supplier || "",
    documentNumber: rec.document_number || "",
    status: rec.status,
    mode: rec.mode === "batch" ? "batch" : "sequential",
    createdBy: rec.created_by || "",
    createdAt: String(rec.created_at),
    completedAt: rec.completed_at ? String(rec.completed_at) : null,
    itemCode: rec.item_code,
    itemName: rec.item_name,
    lotCode: rec.lot_code,
    productionDate: rec.production_date ? String(rec.production_date).slice(0, 10) : null,
    expiryDate: rec.expiry_date ? String(rec.expiry_date).slice(0, 10) : null,
    palletCount: Number(rec.pallet_count),
    qtyPerLpn: Number(rec.qty_per_lpn),
    totalQty: Number(rec.total_qty),
    progress: progressOf(mapped),
    lpns: mapped,
  }
}

async function writeEvent(
  client: PoolClient,
  input: { receivingId: string; lpnId?: string | null; kind: string; actor: string; device: string; detail?: unknown }
) {
  await client.query(
    `INSERT INTO wms_quick_lpn_events (receiving_id, lpn_id, kind, actor, device, detail)
     VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6::jsonb)`,
    [input.receivingId, input.lpnId ?? null, input.kind, input.actor, input.device, JSON.stringify(input.detail ?? {})]
  )
}

export async function listQuickReceivings(client: PoolClient, siteCode: string, limit = 30): Promise<QuickReceivingRow[]> {
  const siteId = await getSiteId(client, siteCode)
  if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "site_not_found")
  await ensureQuickReceivingSchema(client)
  const ids = await client.query<{ receiving_id: string }>(
    `SELECT receiving_id::text FROM wms_quick_receivings WHERE site_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [siteId, Math.min(Math.max(limit, 1), 100)]
  )
  const out: QuickReceivingRow[] = []
  for (const row of ids.rows) out.push(await loadReceiving(client, siteId, row.receiving_id))
  return out
}

export async function getQuickReceiving(client: PoolClient, siteCode: string, receivingId: string) {
  const siteId = await getSiteId(client, siteCode)
  if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "site_not_found")
  await ensureQuickReceivingSchema(client)
  return loadReceiving(client, siteId, receivingId)
}

export async function createQuickReceiving(
  client: PoolClient,
  input: {
    siteCode: string
    supplier?: string
    documentNumber?: string
    itemCode: string
    lotCode: string
    productionDate?: string
    expiryDate?: string
    palletCount: number
    qtyPerLpn: number
    mode?: QuickReceivingMode
    createdBy: string
  }
) {
  const siteId = await getSiteId(client, input.siteCode)
  if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "site_not_found")
  await ensureQuickReceivingSchema(client)

  const item = await resolveItemByCodeOrBarcode(client, siteId, input.itemCode)
  if (!item) throw new WmsHttpError(404, "Номенклатура не найдена", "item_not_found")

  const palletCount = Math.min(Math.max(Math.trunc(input.palletCount), 1), 200)
  const qtyPerLpn = Number(input.qtyPerLpn)
  if (!Number.isFinite(qtyPerLpn) || qtyPerLpn <= 0) {
    throw new WmsHttpError(400, "Количество на палете должно быть больше 0", "bad_qty")
  }
  const lotCode = input.lotCode.trim()
  if (!lotCode) throw new WmsHttpError(400, "Укажите партию", "lot_required")

  const itemExtra = await client.query<{ name: string; shelf_life_days: number | null }>(
    `SELECT name, shelf_life_days FROM wms_items WHERE item_id = $1::bigint`,
    [item.item_id]
  )
  const itemName = itemExtra.rows[0]?.name || item.item_code
  const shelf = Number(itemExtra.rows[0]?.shelf_life_days || 0)
  const productionDate = input.productionDate?.trim() || null
  const expiryDate =
    input.expiryDate?.trim() || (productionDate && shelf > 0 ? addShelfLife(productionDate, shelf) : null)

  const number = await nextNumber(client, siteId, "QR", 3)
  const rec = await client.query<{ receiving_id: string }>(
    `INSERT INTO wms_quick_receivings (
       site_id, number, supplier, document_number, status, mode,
       item_code, item_name, lot_code, production_date, expiry_date,
       pallet_count, qty_per_lpn, total_qty, created_by, started_at
     ) VALUES (
       $1, $2, $3, $4, 'open', $5,
       $6, $7, $8, $9::date, $10::date,
       $11, $12, $13, $14, now()
     ) RETURNING receiving_id::text`,
    [
      siteId,
      number,
      input.supplier?.trim() || "",
      input.documentNumber?.trim() || "",
      input.mode === "batch" ? "batch" : "sequential",
      item.item_code,
      itemName,
      lotCode,
      productionDate,
      expiryDate || null,
      palletCount,
      qtyPerLpn,
      palletCount * qtyPerLpn,
      input.createdBy,
    ]
  )
  const receivingId = rec.rows[0].receiving_id

  for (let i = 0; i < palletCount; i += 1) {
    const lpnCode = await nextNumber(client, siteId, "PAL", 4)
    const lpn = await client.query<{ lpn_id: string }>(
      `INSERT INTO wms_quick_lpns (
         site_id, receiving_id, lpn_code, item_code, item_name, lot_code, qty,
         production_date, expiry_date, status
       ) VALUES (
         $1, $2::bigint, $3, $4, $5, $6, $7,
         $8::date, $9::date, 'WAITING_PRINT'
       ) RETURNING lpn_id::text`,
      [siteId, receivingId, lpnCode, item.item_code, itemName, lotCode, qtyPerLpn, productionDate, expiryDate || null]
    )
    await writeEvent(client, {
      receivingId,
      lpnId: lpn.rows[0].lpn_id,
      kind: "created",
      actor: input.createdBy,
      device: "desktop",
      detail: { lpnCode },
    })
  }

  await writeEvent(client, {
    receivingId,
    kind: "receiving_created",
    actor: input.createdBy,
    device: "desktop",
    detail: { number, palletCount, qtyPerLpn },
  })

  return loadReceiving(client, siteId, receivingId)
}

export async function printQuickLpn(
  client: PoolClient,
  input: {
    siteCode: string
    receivingId: string
    lpnCode: string
    actor: string
    device: string
    reprint?: boolean
    reason?: string
  }
) {
  const siteId = await getSiteId(client, input.siteCode)
  if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "site_not_found")
  await ensureQuickReceivingSchema(client)
  const rec = await loadReceiving(client, siteId, input.receivingId)
  if (rec.status !== "open") throw new WmsHttpError(409, "Приёмка уже закрыта", "closed")
  const lpn = rec.lpns.find((row) => row.lpnCode === input.lpnCode)
  if (!lpn) throw new WmsHttpError(404, "LPN не найден", "lpn_not_found")
  if (lpn.status === "CANCELLED") throw new WmsHttpError(409, "Стикер аннулирован", "cancelled")
  if (lpn.status === "VERIFIED" || lpn.status === "READY_FOR_PUTAWAY" || lpn.status === "STORED") {
    throw new WmsHttpError(409, "Подтверждённый стикер не перепечатывается этой операцией", "already_verified")
  }

  await client.query(
    `UPDATE wms_quick_lpns SET
       status = 'WAITING_VERIFICATION',
       printed_at = COALESCE(printed_at, now()),
       reprint_count = reprint_count + $3,
       last_error = NULL,
       payload_json = payload_json || $4::jsonb
     WHERE lpn_id = $1::bigint AND receiving_id = $2::bigint`,
    [
      lpn.lpnId,
      input.receivingId,
      input.reprint ? 1 : 0,
      JSON.stringify({
        lastPrintAt: new Date().toISOString(),
        lastPrintDevice: input.device,
        lastPrintReason: input.reason || null,
      }),
    ]
  )
  await writeEvent(client, {
    receivingId: input.receivingId,
    lpnId: lpn.lpnId,
    kind: input.reprint ? "reprint" : "print",
    actor: input.actor,
    device: input.device,
    detail: { reason: input.reason || null },
  })
  return loadReceiving(client, siteId, input.receivingId)
}

export async function printAllQuickLpns(
  client: PoolClient,
  input: { siteCode: string; receivingId: string; actor: string; device: string }
) {
  const rec = await getQuickReceiving(client, input.siteCode, input.receivingId)
  const targets = rec.lpns.filter((l) =>
    ["CREATED", "WAITING_PRINT", "PRINT_ERROR"].includes(l.status)
  )
  for (const lpn of targets) {
    await printQuickLpn(client, {
      siteCode: input.siteCode,
      receivingId: input.receivingId,
      lpnCode: lpn.lpnCode,
      actor: input.actor,
      device: input.device,
    })
  }
  return getQuickReceiving(client, input.siteCode, input.receivingId)
}

export async function cancelQuickLpn(
  client: PoolClient,
  input: { siteCode: string; receivingId: string; lpnCode: string; actor: string; device: string; reason?: string }
) {
  const siteId = await getSiteId(client, input.siteCode)
  if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "site_not_found")
  await ensureQuickReceivingSchema(client)
  const rec = await loadReceiving(client, siteId, input.receivingId)
  if (rec.status !== "open") throw new WmsHttpError(409, "Приёмка уже закрыта", "closed")
  const lpn = rec.lpns.find((row) => row.lpnCode === input.lpnCode)
  if (!lpn) throw new WmsHttpError(404, "LPN не найден", "lpn_not_found")
  if (lpn.status === "VERIFIED" || lpn.status === "READY_FOR_PUTAWAY" || lpn.status === "STORED") {
    throw new WmsHttpError(409, "Нельзя аннулировать подтверждённый стикер", "already_verified")
  }
  await client.query(
    `UPDATE wms_quick_lpns SET status = 'CANCELLED', cancelled_at = now(), last_error = $2
     WHERE lpn_id = $1::bigint`,
    [lpn.lpnId, input.reason || "cancelled"]
  )
  await writeEvent(client, {
    receivingId: input.receivingId,
    lpnId: lpn.lpnId,
    kind: "cancel",
    actor: input.actor,
    device: input.device,
    detail: { reason: input.reason || null },
  })
  return loadReceiving(client, siteId, input.receivingId)
}

export async function verifyQuickLpn(
  client: PoolClient,
  input: {
    siteCode: string
    receivingId: string
    scannedCode: string
    actor: string
    device: string
  }
) {
  const siteId = await getSiteId(client, input.siteCode)
  if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "site_not_found")
  await ensureQuickReceivingSchema(client)
  const rec = await loadReceiving(client, siteId, input.receivingId)
  if (rec.status !== "open") throw new WmsHttpError(409, "Приёмка уже закрыта", "closed")

  const scanned = input.scannedCode.trim().toUpperCase()
  const found = await client.query(
    `SELECT lpn_id::text, lpn_code, receiving_id::text, status
     FROM wms_quick_lpns WHERE site_id = $1 AND upper(lpn_code) = $2`,
    [siteId, scanned]
  )
  const row = found.rows[0] as
    | { lpn_id: string; lpn_code: string; receiving_id: string; status: QuickLpnStatus }
    | undefined
  const expected =
    rec.mode === "sequential"
      ? rec.lpns.find((l) => l.status === "WAITING_VERIFICATION" || l.status === "PRINTED" || l.status === "VERIFICATION_ERROR")
          ?.lpnCode ?? null
      : null

  const decision = decideVerify({
    scanned,
    receivingId: rec.receivingId,
    sequential: rec.mode === "sequential",
    expectedCode: expected,
    lpn: row
      ? { lpnCode: row.lpn_code, receivingId: row.receiving_id, status: row.status }
      : null,
  })

  if (!decision.ok) {
    if (row && row.receiving_id === rec.receivingId && row.status !== "VERIFIED") {
      await client.query(
        `UPDATE wms_quick_lpns SET last_error = $2 WHERE lpn_id = $1::bigint AND status NOT IN ('VERIFIED','CANCELLED')`,
        [row.lpn_id, decision.message]
      )
    }
    await writeEvent(client, {
      receivingId: rec.receivingId,
      lpnId: row?.lpn_id,
      kind: "verify_fail",
      actor: input.actor,
      device: input.device,
      detail: { scanned, ...decision },
    })
    throw new WmsHttpError(409, decision.message, decision.code, {
      expected: expected,
      scanned,
    })
  }

  await client.query(
    `UPDATE wms_quick_lpns SET
       status = 'VERIFIED',
       verified_at = now(),
       last_error = NULL
     WHERE lpn_id = $1::bigint`,
    [row!.lpn_id]
  )
  await writeEvent(client, {
    receivingId: rec.receivingId,
    lpnId: row!.lpn_id,
    kind: "verify_ok",
    actor: input.actor,
    device: input.device,
    detail: { scanned },
  })

  const next = await loadReceiving(client, siteId, rec.receivingId)
  const nextLpn =
    next.mode === "sequential"
      ? next.lpns.find((l) => l.status === "WAITING_PRINT" || l.status === "WAITING_VERIFICATION" || l.status === "PRINTED")
          ?.lpnCode ?? null
      : next.lpns.find((l) => l.status === "WAITING_VERIFICATION" || l.status === "PRINTED")?.lpnCode ?? null

  return { receiving: next, lpn: scanned, status: "VERIFIED" as const, nextLpn }
}

export async function completeQuickReceiving(
  client: PoolClient,
  input: { siteCode: string; receivingId: string; actor: string; cancelRemaining?: boolean }
) {
  const siteId = await getSiteId(client, input.siteCode)
  if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "site_not_found")
  await ensureQuickReceivingSchema(client)
  const rec = await loadReceiving(client, siteId, input.receivingId)
  if (rec.status !== "open") return rec
  const pending = rec.lpns.filter(
    (l) => l.status !== "VERIFIED" && l.status !== "READY_FOR_PUTAWAY" && l.status !== "STORED" && l.status !== "CANCELLED"
  )
  if (pending.length > 0 && !input.cancelRemaining) {
    throw new WmsHttpError(409, "Нельзя завершить: есть неподтверждённые LPN", "pending_lpns", {
      pending: pending.map((l) => l.lpnCode),
    })
  }
  if (input.cancelRemaining && pending.length > 0) {
    await client.query(
      `UPDATE wms_quick_lpns SET status = 'CANCELLED', cancelled_at = now()
       WHERE receiving_id = $1::bigint AND status NOT IN ('VERIFIED','READY_FOR_PUTAWAY','STORED','CANCELLED')`,
      [input.receivingId]
    )
  }
  await client.query(
    `UPDATE wms_quick_receivings SET status = 'completed', completed_at = now() WHERE receiving_id = $1::bigint`,
    [input.receivingId]
  )
  await writeEvent(client, {
    receivingId: input.receivingId,
    kind: "completed",
    actor: input.actor,
    device: "desktop",
    detail: { cancelRemaining: Boolean(input.cancelRemaining) },
  })
  return loadReceiving(client, siteId, input.receivingId)
}

export async function createQuickItem(
  client: PoolClient,
  input: {
    siteCode: string
    name: string
    category?: string
    uom?: string
    manufacturer?: string
    sku?: string
    barcode?: string
    shelfLifeDays?: number
    temp?: boolean
  }
) {
  const siteId = await getSiteId(client, input.siteCode)
  if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "site_not_found")
  const name = input.name.trim()
  if (!name) throw new WmsHttpError(400, "Укажите название", "name_required")
  const sku = (input.sku || "").trim() || `TEMP-${Date.now().toString(36).toUpperCase()}`
  const itemCode = sku
  const wantedGroup = (input.category || "").trim()
  const groupHit = await client.query<{ group_code: string }>(
    `SELECT group_code
     FROM wms_item_groups
     WHERE site_id = $1
       AND (
         $2 = ''
         OR lower(group_code) = lower($2)
         OR lower(name) = lower($2)
         OR group_code IN ('Прочее сырье и материалы', 'Преформа')
       )
     ORDER BY CASE
       WHEN $2 <> '' AND lower(group_code) = lower($2) THEN 0
       WHEN $2 <> '' AND lower(name) = lower($2) THEN 1
       WHEN group_code = 'Прочее сырье и материалы' THEN 2
       WHEN group_code = 'Преформа' THEN 3
       ELSE 4
     END
     LIMIT 1`,
    [siteId, wantedGroup]
  )
  const group = groupHit.rows[0]?.group_code
  if (!group) throw new WmsHttpError(400, "Нет группы номенклатуры на площадке", "no_group")
  const attrs = {
    nomenclature: {
      manufacturer: input.manufacturer || "",
      source: "quick-receiving",
      requiresClassification: Boolean(input.temp),
    },
  }
  const r = await client.query<{ item_code: string; name: string; shelf_life_days: number | null }>(
    `INSERT INTO wms_items (
       site_id, item_code, sku, name, material_type, product_group, item_group_code,
       item_type_code, uom_code, item_attrs_json, is_marked, is_perishable, rotation_policy,
       shelf_life_days, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $6,
       'materials', $7, $8::jsonb, FALSE, TRUE, 'fefo',
       $9, now(), now()
     )
     ON CONFLICT (site_id, item_code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING item_code, name, shelf_life_days`,
    [
      siteId,
      itemCode,
      sku,
      input.temp ? `${name} (требует классификации)` : name,
      group,
      group,
      input.uom?.trim() || "pcs",
      JSON.stringify(attrs),
      input.shelfLifeDays && input.shelfLifeDays > 0 ? Math.trunc(input.shelfLifeDays) : null,
    ]
  )
  const barcode = input.barcode?.trim()
  if (barcode) {
    await client.query(
      `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
       SELECT item_id, $2, 'supplier', TRUE, now()
       FROM wms_items WHERE site_id = $1 AND item_code = $3
       ON CONFLICT (barcode) DO UPDATE SET item_id = EXCLUDED.item_id, is_primary = TRUE`,
      [siteId, barcode, itemCode]
    )
  }
  return {
    itemCode: r.rows[0].item_code,
    itemName: r.rows[0].name,
    shelfLifeDays: r.rows[0].shelf_life_days,
    requiresClassification: Boolean(input.temp),
  }
}

export function labelPayload(lpn: QuickLpnRow) {
  return {
    title: lpn.itemName,
    lot: lpn.lotCode,
    productionDate: lpn.productionDate,
    expiryDate: lpn.expiryDate,
    qty: lpn.qty,
    lpn: lpn.lpnCode,
    datamatrixUrl: `/api/wms/marking/datamatrix?text=${encodeURIComponent(lpn.lpnCode)}`,
  }
}
