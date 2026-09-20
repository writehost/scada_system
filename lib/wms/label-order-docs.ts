import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"
import {
  DEFAULT_LABEL_ORDER_WASTE_SETTINGS,
  parseLabelOrderWasteSettings,
  plannedWasteQty,
  summarizeLabelOrderFact,
  type LabelOrderAdjustment,
  type LabelOrderFact,
  type LabelOrderWasteSettings,
} from "@/lib/wms/label-order-waste"
import {
  parseLabelSuzSettings,
  type LabelSuzSettings,
} from "@/lib/wms/label-suz-settings"
import { ensurePrintTerminal } from "@/lib/wms/print-terminal"

/**
 * Документ заказа кодов: кто заказал, откуда, когда, сколько заказал и что по факту
 * ушло в печать. Очередь заказов живёт в sqlite сайдкара на scada25 (там нет ни
 * пользователей, ни истории), поэтому документ, журнал событий и корректировки
 * храним в базе WMS и склеиваем с очередью по `orderId`.
 */

export const LABEL_ORDER_WASTE_SETTING_KEY = "label_order_waste"
export const LABEL_SUZ_SETTING_KEY = "label_suz"

export type LabelOrderOrigin = "wms-ui" | "printer-terminal" | "import" | "unknown"

export type LabelOrderDoc = {
  orderId: string
  docNo: string
  createdAt: string
  authorFio: string
  authorLogin: string
  authorPosition: string
  origin: LabelOrderOrigin
  originDetail: string
  gtin: string
  itemCode: string
  nomenclatureName: string
  stickerType: string
  /** Сколько кодов в заказе. */
  quantity: number
  /** Плановый хвост прокрутки на момент создания. */
  plannedWasteQty: number
  /** Плановая погрешность, % (фиксируется в документе, чтобы факт сверялся с планом заказа). */
  wastePercent: number
  comment: string
}

export type LabelOrderEvent = {
  eventId: string
  at: string
  kind: string
  authorFio: string
  authorLogin: string
  origin: string
  detail: string
}

export type LabelOrderDocBundle = {
  doc: LabelOrderDoc
  fact: LabelOrderFact
  adjustments: LabelOrderAdjustment[]
  events: LabelOrderEvent[]
}

export type LabelOrderAuthor = {
  login: string
  fio: string
  position: string
}

export const UNKNOWN_LABEL_ORDER_AUTHOR: LabelOrderAuthor = {
  login: "",
  fio: "",
  position: "",
}

let schemaReady = false

/** DDL один раз на процесс: заказы читаются каждые 15 с, ALTER на каждый GET не нужен. */
export async function ensureLabelOrderSchema(client: PoolClient): Promise<void> {
  if (schemaReady) return
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_label_order_docs (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      order_id TEXT NOT NULL,
      doc_no TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      author_login TEXT,
      author_fio TEXT,
      author_position TEXT,
      origin TEXT NOT NULL DEFAULT 'unknown',
      origin_detail TEXT,
      gtin TEXT,
      item_code TEXT,
      nomenclature_name TEXT,
      sticker_type TEXT,
      quantity NUMERIC NOT NULL DEFAULT 0,
      planned_waste_qty NUMERIC NOT NULL DEFAULT 0,
      waste_percent NUMERIC NOT NULL DEFAULT 0,
      comment TEXT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (site_id, order_id)
    )`)
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_wms_label_order_docs_no
      ON wms_label_order_docs(site_id, doc_no)`)
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_label_order_adjustments (
      adjustment_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      order_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      author_login TEXT,
      author_fio TEXT,
      kind TEXT NOT NULL DEFAULT 'fact',
      printed_qty NUMERIC NOT NULL DEFAULT 0,
      spooled_qty NUMERIC NOT NULL DEFAULT 0,
      defect_qty NUMERIC NOT NULL DEFAULT 0,
      comment TEXT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      reverted_at TIMESTAMPTZ,
      reverted_by TEXT
    )`)
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_wms_label_order_adjustments_order
      ON wms_label_order_adjustments(site_id, order_id, created_at DESC)`)
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_label_order_events (
      event_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      order_id TEXT NOT NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      kind TEXT NOT NULL,
      author_login TEXT,
      author_fio TEXT,
      origin TEXT,
      detail TEXT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
    )`)
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_wms_label_order_events_order
      ON wms_label_order_events(site_id, order_id, at DESC)`)
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_app_settings (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      setting_key TEXT NOT NULL,
      setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, setting_key)
    )`)
  schemaReady = true
}

export async function getLabelOrderWasteSettings(
  client: PoolClient,
  siteId: number
): Promise<LabelOrderWasteSettings> {
  await ensureLabelOrderSchema(client)
  const r = await client.query<{ setting_value: unknown; updated_at: string | null }>(
    `SELECT setting_value, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS updated_at
     FROM wms_app_settings
     WHERE site_id = $1 AND setting_key = $2`,
    [siteId, LABEL_ORDER_WASTE_SETTING_KEY]
  )
  if (r.rows.length === 0) return { ...DEFAULT_LABEL_ORDER_WASTE_SETTINGS }
  const parsed = parseLabelOrderWasteSettings(r.rows[0]?.setting_value)
  return { ...parsed, updatedAt: r.rows[0]?.updated_at ?? parsed.updatedAt ?? null }
}

export async function saveLabelOrderWasteSettings(
  client: PoolClient,
  siteId: number,
  input: unknown,
  author: LabelOrderAuthor
): Promise<LabelOrderWasteSettings> {
  await ensureLabelOrderSchema(client)
  const next = parseLabelOrderWasteSettings(input)
  const payload = {
    wastePercent: next.wastePercent,
    minWasteQty: next.minWasteQty,
    addWasteToOrder: next.addWasteToOrder,
    roundTo: next.roundTo,
    alertPercent: next.alertPercent,
    requireFactAfterPrint: next.requireFactAfterPrint,
    updatedBy: author.fio || author.login || null,
  }
  const r = await client.query<{ setting_value: unknown; updated_at: string | null }>(
    `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (site_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()
     RETURNING setting_value, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS updated_at`,
    [siteId, LABEL_ORDER_WASTE_SETTING_KEY, JSON.stringify(payload)]
  )
  const parsed = parseLabelOrderWasteSettings(r.rows[0]?.setting_value)
  return { ...parsed, updatedAt: r.rows[0]?.updated_at ?? null }
}

export async function getLabelSuzSettingsRow(
  client: PoolClient,
  siteId: number
): Promise<LabelSuzSettings | null> {
  await ensureLabelOrderSchema(client)
  const r = await client.query<{ setting_value: unknown }>(
    `SELECT setting_value
     FROM wms_app_settings
     WHERE site_id = $1 AND setting_key = $2`,
    [siteId, LABEL_SUZ_SETTING_KEY]
  )
  if (r.rows.length === 0) return null
  return parseLabelSuzSettings(r.rows[0]?.setting_value)
}

export async function saveLabelSuzSettingsRow(
  client: PoolClient,
  siteId: number,
  input: unknown
): Promise<LabelSuzSettings> {
  await ensureLabelOrderSchema(client)
  const next = parseLabelSuzSettings(input)
  const payload = {
    omsId: next.omsId,
    clientToken: next.clientToken,
    suzBaseUrl: next.suzBaseUrl,
    productGroup: next.productGroup,
    templateId: next.templateId,
    serialNumberType: next.serialNumberType,
    cisType: next.cisType,
  }
  const r = await client.query<{ setting_value: unknown }>(
    `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (site_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()
     RETURNING setting_value`,
    [siteId, LABEL_SUZ_SETTING_KEY, JSON.stringify(payload)]
  )
  return parseLabelSuzSettings(r.rows[0]?.setting_value)
}

function normalizeOrigin(raw: unknown): LabelOrderOrigin {
  const value = String(raw ?? "").trim().toLowerCase()
  if (value === "wms-ui" || value === "wms") return "wms-ui"
  if (value === "printer-terminal" || value === "terminal") return "printer-terminal"
  if (value === "import") return "import"
  return "unknown"
}

type DocRow = {
  order_id: string
  doc_no: string
  created_at: string
  author_login: string | null
  author_fio: string | null
  author_position: string | null
  origin: string | null
  origin_detail: string | null
  gtin: string | null
  item_code: string | null
  nomenclature_name: string | null
  sticker_type: string | null
  quantity: string | number
  planned_waste_qty: string | number
  waste_percent: string | number
  comment: string | null
}

function mapDoc(row: DocRow): LabelOrderDoc {
  return {
    orderId: row.order_id,
    docNo: row.doc_no,
    createdAt: row.created_at,
    authorFio: row.author_fio ?? "",
    authorLogin: row.author_login ?? "",
    authorPosition: row.author_position ?? "",
    origin: normalizeOrigin(row.origin),
    originDetail: row.origin_detail ?? "",
    gtin: row.gtin ?? "",
    itemCode: row.item_code ?? "",
    nomenclatureName: row.nomenclature_name ?? "",
    stickerType: row.sticker_type ?? "",
    quantity: Number(row.quantity) || 0,
    plannedWasteQty: Number(row.planned_waste_qty) || 0,
    wastePercent: Number(row.waste_percent) || 0,
    comment: row.comment ?? "",
  }
}

const DOC_COLUMNS = `order_id, doc_no, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS created_at, author_login, author_fio,
  author_position, origin, origin_detail, gtin, item_code, nomenclature_name, sticker_type,
  quantity, planned_waste_qty, waste_percent, comment`

type AdjustmentRow = {
  adjustment_id: string
  order_id: string
  created_at: string
  author_login: string | null
  author_fio: string | null
  kind: string
  printed_qty: string | number
  spooled_qty: string | number
  defect_qty: string | number
  comment: string | null
  reverted_at: string | null
  reverted_by: string | null
}

function mapAdjustment(row: AdjustmentRow): LabelOrderAdjustment {
  return {
    adjustmentId: String(row.adjustment_id),
    createdAt: row.created_at,
    authorFio: row.author_fio ?? "",
    authorLogin: row.author_login ?? "",
    kind: row.kind || "fact",
    printedQty: Number(row.printed_qty) || 0,
    spooledQty: Number(row.spooled_qty) || 0,
    defectQty: Number(row.defect_qty) || 0,
    comment: row.comment ?? "",
    revertedAt: row.reverted_at,
    revertedBy: row.reverted_by,
  }
}

/** Документы, корректировки и события для списка заказов — три запроса на всю страницу. */
export async function loadLabelOrderBundles(
  client: PoolClient,
  siteId: number,
  orderIds: string[]
): Promise<Map<string, LabelOrderDocBundle>> {
  await ensureLabelOrderSchema(client)
  const ids = orderIds.map((id) => String(id || "").trim()).filter(Boolean)
  const out = new Map<string, LabelOrderDocBundle>()
  if (ids.length === 0) return out

  const docs = await client.query<DocRow>(
    `SELECT ${DOC_COLUMNS}
     FROM wms_label_order_docs
     WHERE site_id = $1 AND order_id = ANY($2::text[])`,
    [siteId, ids]
  )
  const adjustments = await client.query<AdjustmentRow>(
    `SELECT adjustment_id, order_id, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS created_at, author_login, author_fio,
            kind, printed_qty, spooled_qty, defect_qty, comment,
            to_char(reverted_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS reverted_at, reverted_by
     FROM wms_label_order_adjustments
     WHERE site_id = $1 AND order_id = ANY($2::text[])
     ORDER BY created_at DESC, adjustment_id DESC`,
    [siteId, ids]
  )
  const events = await client.query<{
    event_id: string
    order_id: string
    at: string
    kind: string
    author_login: string | null
    author_fio: string | null
    origin: string | null
    detail: string | null
  }>(
    `SELECT event_id, order_id, to_char(at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS at, kind, author_login, author_fio, origin, detail
     FROM wms_label_order_events
     WHERE site_id = $1 AND order_id = ANY($2::text[])
     ORDER BY at DESC, event_id DESC`,
    [siteId, ids]
  )

  const adjByOrder = new Map<string, LabelOrderAdjustment[]>()
  for (const row of adjustments.rows) {
    const list = adjByOrder.get(row.order_id) ?? []
    list.push(mapAdjustment(row))
    adjByOrder.set(row.order_id, list)
  }
  const eventsByOrder = new Map<string, LabelOrderEvent[]>()
  for (const row of events.rows) {
    const list = eventsByOrder.get(row.order_id) ?? []
    list.push({
      eventId: String(row.event_id),
      at: row.at,
      kind: row.kind,
      authorFio: row.author_fio ?? "",
      authorLogin: row.author_login ?? "",
      origin: row.origin ?? "",
      detail: row.detail ?? "",
    })
    eventsByOrder.set(row.order_id, list)
  }

  for (const row of docs.rows) {
    const adj = adjByOrder.get(row.order_id) ?? []
    out.set(row.order_id, {
      doc: mapDoc(row),
      adjustments: adj,
      fact: summarizeLabelOrderFact(adj),
      events: eventsByOrder.get(row.order_id) ?? [],
    })
  }
  // Корректировки могут существовать без документа (заказ удалён из очереди) — не теряем их.
  for (const [orderId, adj] of adjByOrder) {
    if (out.has(orderId)) continue
    out.set(orderId, {
      doc: {
        orderId,
        docNo: "",
        createdAt: adj[adj.length - 1]?.createdAt ?? new Date().toISOString(),
        authorFio: "",
        authorLogin: "",
        authorPosition: "",
        origin: "unknown",
        originDetail: "",
        gtin: "",
        itemCode: "",
        nomenclatureName: "",
        stickerType: "",
        quantity: 0,
        plannedWasteQty: 0,
        wastePercent: 0,
        comment: "",
      },
      adjustments: adj,
      fact: summarizeLabelOrderFact(adj),
      events: eventsByOrder.get(orderId) ?? [],
    })
  }
  return out
}

function docNoPrefix(at: Date): string {
  const y = String(at.getFullYear()).slice(-2)
  const m = String(at.getMonth() + 1).padStart(2, "0")
  const d = String(at.getDate()).padStart(2, "0")
  return `ZK-${y}${m}${d}`
}

async function nextDocNo(client: PoolClient, siteId: number, at: Date): Promise<string> {
  const prefix = docNoPrefix(at)
  const r = await client.query<{ doc_no: string }>(
    `SELECT doc_no
     FROM wms_label_order_docs
     WHERE site_id = $1 AND doc_no LIKE $2
     ORDER BY doc_no DESC
     LIMIT 1`,
    [siteId, `${prefix}-%`]
  )
  const last = r.rows[0]?.doc_no ?? ""
  const seq = Number(last.slice(prefix.length + 1)) || 0
  return `${prefix}-${String(seq + 1).padStart(2, "0")}`
}

export async function appendLabelOrderEvent(
  client: PoolClient,
  siteId: number,
  input: {
    orderId: string
    kind: string
    author?: LabelOrderAuthor
    origin?: string
    detail?: string
    at?: Date | string | null
    payload?: Record<string, unknown>
  }
): Promise<void> {
  await ensureLabelOrderSchema(client)
  const at = input.at ? new Date(input.at) : null
  await client.query(
    `INSERT INTO wms_label_order_events
       (site_id, order_id, at, kind, author_login, author_fio, origin, detail, payload_json)
     VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      siteId,
      input.orderId,
      at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
      input.kind,
      input.author?.login || null,
      input.author?.fio || null,
      input.origin || null,
      input.detail || null,
      JSON.stringify(input.payload ?? {}),
    ]
  )
}

export async function createLabelOrderDoc(
  client: PoolClient,
  siteId: number,
  input: {
    orderId: string
    author: LabelOrderAuthor
    origin: LabelOrderOrigin
    originDetail?: string
    gtin: string
    itemCode?: string
    nomenclatureName: string
    stickerType: string
    quantity: number
    plannedWasteQty: number
    wastePercent: number
    comment?: string
    createdAt?: string | null
    payload?: Record<string, unknown>
  }
): Promise<LabelOrderDoc> {
  await ensureLabelOrderSchema(client)
  const createdAt = input.createdAt ? new Date(input.createdAt) : new Date()
  const at = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const docNo = await nextDocNo(client, siteId, at)
    try {
      const r = await client.query<DocRow>(
        `INSERT INTO wms_label_order_docs
           (site_id, order_id, doc_no, created_at, author_login, author_fio, author_position,
            origin, origin_detail, gtin, item_code, nomenclature_name, sticker_type,
            quantity, planned_waste_qty, waste_percent, comment, payload_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
         ON CONFLICT (site_id, order_id) DO NOTHING
         RETURNING ${DOC_COLUMNS}`,
        [
          siteId,
          input.orderId,
          docNo,
          at.toISOString(),
          input.author.login || null,
          input.author.fio || null,
          input.author.position || null,
          input.origin,
          input.originDetail || null,
          input.gtin || null,
          input.itemCode || null,
          input.nomenclatureName || null,
          input.stickerType || null,
          Math.max(0, Math.round(input.quantity)),
          Math.max(0, Math.round(input.plannedWasteQty)),
          input.wastePercent,
          input.comment || null,
          JSON.stringify(input.payload ?? {}),
        ]
      )
      if (r.rows[0]) return mapDoc(r.rows[0])
      // Документ уже был создан параллельным запросом — отдаём существующий.
      const existing = await client.query<DocRow>(
        `SELECT ${DOC_COLUMNS} FROM wms_label_order_docs WHERE site_id = $1 AND order_id = $2`,
        [siteId, input.orderId]
      )
      if (existing.rows[0]) return mapDoc(existing.rows[0])
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code !== "23505") throw e
      // Номер занят соседним заказом — берём следующий.
    }
  }
  throw new WmsHttpError(409, "Не удалось выделить номер документа заказа", "label_doc_no_conflict")
}

/**
 * Заказы, созданные до появления документов (и все заказы с терминала печати),
 * получают документ при первом чтении списка — иначе на них нельзя ссылаться
 * в корректировках и в истории.
 */
export async function backfillLabelOrderDocs(
  client: PoolClient,
  siteId: number,
  orders: Array<{
    id: string
    createdAt: string
    gtin: string
    nomenclatureName: string
    stickerType: string
    quantity: number
    source: string
    deviceId: string
  }>,
  settings: LabelOrderWasteSettings
): Promise<number> {
  if (orders.length === 0) return 0
  await ensureLabelOrderSchema(client)
  const existing = await client.query<{ order_id: string }>(
    `SELECT order_id FROM wms_label_order_docs WHERE site_id = $1 AND order_id = ANY($2::text[])`,
    [siteId, orders.map((o) => o.id)]
  )
  const known = new Set(existing.rows.map((r) => r.order_id))
  const missing = orders
    .filter((o) => !known.has(o.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  let created = 0
  for (const order of missing) {
    const origin: LabelOrderOrigin =
      normalizeOrigin(order.source) === "unknown" ? "printer-terminal" : normalizeOrigin(order.source)
    const originDetail = order.deviceId
      ? `Печатный терминал · ${order.deviceId}`
      : "Печатный терминал"
    if (order.deviceId && origin === "printer-terminal") {
      await ensurePrintTerminal(client, siteId, {
        rawDeviceId: order.deviceId,
        lastSeenAt: order.createdAt,
      }).catch(() => undefined)
    }
    const doc = await createLabelOrderDoc(client, siteId, {
      orderId: order.id,
      author: UNKNOWN_LABEL_ORDER_AUTHOR,
      origin,
      originDetail,
      gtin: order.gtin,
      nomenclatureName: order.nomenclatureName,
      stickerType: order.stickerType,
      quantity: order.quantity,
      plannedWasteQty: plannedWasteQty(order.quantity, settings),
      wastePercent: settings.wastePercent,
      comment: "",
      createdAt: order.createdAt,
      payload: { backfilled: true },
    })
    await appendLabelOrderEvent(client, siteId, {
      orderId: order.id,
      kind: "created",
      origin: originDetail,
      detail:
        origin === "printer-terminal"
          ? `Заказ пришёл с терминала печати${order.deviceId ? ` (${order.deviceId})` : ""}`
          : "Заказ восстановлен из очереди печати",
      at: order.createdAt,
      payload: { docNo: doc.docNo, backfilled: true },
    })
    created += 1
  }
  return created
}

export async function addLabelOrderAdjustment(
  client: PoolClient,
  siteId: number,
  input: {
    orderId: string
    author: LabelOrderAuthor
    origin?: string
    kind?: string
    printedQty: number
    spooledQty: number
    defectQty: number
    comment?: string
  }
): Promise<LabelOrderAdjustment> {
  await ensureLabelOrderSchema(client)
  const printed = Math.max(0, Math.round(input.printedQty))
  const spooled = Math.max(0, Math.round(input.spooledQty))
  const defect = Math.max(0, Math.round(input.defectQty))
  if (printed + spooled + defect === 0) {
    throw new WmsHttpError(
      400,
      "Заполните хотя бы одно поле: напечатано, промотано или брак",
      "label_adjustment_empty"
    )
  }
  const r = await client.query<AdjustmentRow>(
    `INSERT INTO wms_label_order_adjustments
       (site_id, order_id, author_login, author_fio, kind, printed_qty, spooled_qty, defect_qty, comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING adjustment_id, order_id, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS created_at, author_login, author_fio,
               kind, printed_qty, spooled_qty, defect_qty, comment,
               to_char(reverted_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS reverted_at, reverted_by`,
    [
      siteId,
      input.orderId,
      input.author.login || null,
      input.author.fio || null,
      input.kind || "fact",
      printed,
      spooled,
      defect,
      input.comment?.trim() || null,
    ]
  )
  const adjustment = mapAdjustment(r.rows[0]!)
  await appendLabelOrderEvent(client, siteId, {
    orderId: input.orderId,
    kind: "adjustment",
    author: input.author,
    origin: input.origin || "интерфейс WMS",
    detail: `Факт печати: годных ${printed}, промотано ${spooled}${defect ? `, брак ${defect}` : ""}`,
    payload: { adjustmentId: adjustment.adjustmentId, printed, spooled, defect },
  })
  return adjustment
}

export async function revertLabelOrderAdjustment(
  client: PoolClient,
  siteId: number,
  input: { adjustmentId: string; author: LabelOrderAuthor; origin?: string }
): Promise<void> {
  await ensureLabelOrderSchema(client)
  const id = Number(input.adjustmentId)
  if (!Number.isFinite(id)) {
    throw new WmsHttpError(400, "Неверный идентификатор корректировки", "label_adjustment_bad_id")
  }
  const r = await client.query<{ order_id: string }>(
    `UPDATE wms_label_order_adjustments
     SET reverted_at = now(), reverted_by = $3
     WHERE site_id = $1 AND adjustment_id = $2 AND reverted_at IS NULL
     RETURNING order_id`,
    [siteId, id, input.author.fio || input.author.login || "—"]
  )
  const orderId = r.rows[0]?.order_id
  if (!orderId) {
    throw new WmsHttpError(404, "Корректировка не найдена или уже отменена", "label_adjustment_missing")
  }
  await appendLabelOrderEvent(client, siteId, {
    orderId,
    kind: "adjustment_reverted",
    author: input.author,
    origin: input.origin || "интерфейс WMS",
    detail: "Корректировка отменена",
    payload: { adjustmentId: String(id) },
  })
}

/** Обновление плана в документе: количество могло измениться при заказе КМ в СУЗ. */
export async function syncLabelOrderDocPlan(
  client: PoolClient,
  siteId: number,
  input: { orderId: string; quantity: number; settings: LabelOrderWasteSettings }
): Promise<void> {
  await ensureLabelOrderSchema(client)
  await client.query(
    `UPDATE wms_label_order_docs
     SET quantity = $3, planned_waste_qty = $4
     WHERE site_id = $1 AND order_id = $2 AND quantity <> $3`,
    [
      siteId,
      input.orderId,
      Math.max(0, Math.round(input.quantity)),
      plannedWasteQty(input.quantity, input.settings),
    ]
  )
}
