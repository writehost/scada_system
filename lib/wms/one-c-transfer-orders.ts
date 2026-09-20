import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { createDocumentWithTasks } from "@/lib/wms/documents"
import {
  getOneCSettings,
  normalizeODataRoot,
  oneCRequest,
  type OneCSettings,
} from "@/lib/wms/one-c-erp"
import {
  DEFAULT_TRANSFER_HEADER,
  emptyErpCatalogs,
  type ErpCatalogKind,
  type ErpCatalogItem,
  type ErpTransferCatalogs,
} from "@/lib/wms/one-c-transfer-fields"

export const TRANSFER_SYNC_SETTING_KEY = "integration_1c_erp_transfers"
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000"
const DOC_PAGE_SIZE = 40
const CATALOG_PAGE_SIZE = 100
const FULL_PAGES_PER_CALL = 12
const ENTITY = "Document_ЗаказНаПеремещение"

const CLOSED_STATUSES = new Set(["закрыт", "отменен", "отменён", "аннулирован"])

export type TransferSyncSettings = {
  continuous: boolean
  lastFullSyncAt: string | null
  lastIncrementalAt: string | null
  lastWatermarkDate: string | null
  lastError: string | null
  defaultOrganizationKey: string
  defaultRecipientOrganizationKey: string
  defaultPriorityKey: string
  defaultAuthorKey: string
  defaultDepartmentKey: string
  defaultResponsibleKey: string
  defaultSourceWarehouseKey: string
  defaultTargetWarehouseKey: string
  defaultStatus: string
  defaultOperation: string
  defaultDeliveryMethod: string
  defaultActivity: string
  defaultAcceptanceVariant: string
  defaultSupplyVariant: string
}

export type ErpWarehouse = {
  refKey: string
  code: string
  name: string
  wmsCode: string | null
}

export type ErpTransferOrderRow = {
  refKey: string
  documentNo: string
  docDate: string | null
  posted: boolean
  deletionMark: boolean
  status: string
  operation: string
  comment: string
  sourceWarehouseKey: string
  targetWarehouseKey: string
  sourceWarehouseName: string
  targetWarehouseName: string
  organizationKey: string
  lineCount: number
  wmsDocumentId: string | null
  createdFrom: string
  lastSeenAt: string
  payload: Record<string, unknown>
}

export type TransferSyncResult = {
  ok: true
  mode: "full" | "incremental"
  done: boolean
  nextSkip: number
  totalIn1C: number
  fetched: number
  pages: number
  upserted: number
  tasksCreated: number
  warehousesSynced: number
  skippedClosed: number
  unmatchedLines: number
}

export type CreateErpTransferInput = {
  requestId?: string
  comment?: string
  sourceWarehouseKey: string
  targetWarehouseKey: string
  organizationKey?: string
  recipientOrganizationKey?: string
  priorityKey?: string
  authorKey?: string
  departmentKey?: string
  responsibleKey?: string
  status?: string
  operation?: string
  deliveryMethod?: string
  activity?: string
  acceptanceVariant?: string
  supplyVariant?: string
  lines: Array<{
    itemCode: string
    nomenclatureKey?: string
    qty: number
  }>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function pickStr(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim()
    if (text && text !== EMPTY_GUID) return text
  }
  return ""
}

function isEmptyODataValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === "string") {
    const text = value.trim()
    if (!text || text === EMPTY_GUID || text.startsWith("0001-01-01")) return true
  }
  return false
}

export function stripEmptyOData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripEmptyOData(item))
      .filter((item) => {
        if (item == null) return false
        if (typeof item === "object" && !Array.isArray(item) && Object.keys(item as object).length === 0) return false
        return true
      })
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith("odata.") || key.startsWith("@odata")) continue
      if (isEmptyODataValue(nested)) continue
      const next = stripEmptyOData(nested)
      if (isEmptyODataValue(next)) continue
      if (next && typeof next === "object" && !Array.isArray(next) && Object.keys(next as object).length === 0) continue
      if (Array.isArray(next) && next.length === 0) continue
      out[key] = next
    }
    return out
  }
  return value
}

function jsonObject(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {}
}

function defaultTransferSettings(): TransferSyncSettings {
  return {
    continuous: false,
    lastFullSyncAt: null,
    lastIncrementalAt: null,
    lastWatermarkDate: null,
    lastError: null,
    defaultOrganizationKey: "",
    defaultRecipientOrganizationKey: "",
    defaultPriorityKey: "",
    defaultAuthorKey: "",
    defaultDepartmentKey: "",
    defaultResponsibleKey: "",
    defaultSourceWarehouseKey: "",
    defaultTargetWarehouseKey: "",
    defaultStatus: DEFAULT_TRANSFER_HEADER.status,
    defaultOperation: DEFAULT_TRANSFER_HEADER.operation,
    defaultDeliveryMethod: DEFAULT_TRANSFER_HEADER.deliveryMethod,
    defaultActivity: DEFAULT_TRANSFER_HEADER.activity,
    defaultAcceptanceVariant: DEFAULT_TRANSFER_HEADER.acceptanceVariant,
    defaultSupplyVariant: DEFAULT_TRANSFER_HEADER.supplyVariant,
  }
}

export async function ensureTransferOrderTables(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_erp_warehouses (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      ref_key TEXT NOT NULL,
      code TEXT,
      name TEXT,
      wms_warehouse_id BIGINT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, ref_key)
    )`)
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_erp_transfer_orders (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      ref_key TEXT NOT NULL,
      document_no TEXT,
      doc_date TIMESTAMPTZ,
      posted BOOLEAN NOT NULL DEFAULT FALSE,
      deletion_mark BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT,
      operation TEXT,
      comment TEXT,
      source_warehouse_key TEXT,
      target_warehouse_key TEXT,
      organization_key TEXT,
      source_warehouse_name TEXT,
      target_warehouse_name TEXT,
      max_line_code TEXT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      wms_document_id BIGINT,
      created_from TEXT NOT NULL DEFAULT '1c',
      last_data_version TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, ref_key)
    )`)
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_wms_erp_transfer_orders_date
      ON wms_erp_transfer_orders (site_id, doc_date DESC)`)
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_wms_erp_transfer_orders_status
      ON wms_erp_transfer_orders (site_id, status)`)
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_erp_catalogs (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      catalog_kind TEXT NOT NULL,
      ref_key TEXT NOT NULL,
      code TEXT,
      name TEXT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, catalog_kind, ref_key)
    )`)
}

export async function getTransferSyncSettings(
  client: PoolClient,
  siteId: number
): Promise<TransferSyncSettings> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_app_settings (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      setting_key TEXT NOT NULL,
      setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, setting_key)
    )`)
  const r = await client.query<{ setting_value: unknown }>(
    `SELECT setting_value FROM wms_app_settings WHERE site_id = $1 AND setting_key = $2`,
    [siteId, TRANSFER_SYNC_SETTING_KEY]
  )
  const v = jsonObject(r.rows[0]?.setting_value)
  const base = defaultTransferSettings()
  return {
    continuous: v.continuous === true,
    lastFullSyncAt: typeof v.lastFullSyncAt === "string" ? v.lastFullSyncAt : null,
    lastIncrementalAt: typeof v.lastIncrementalAt === "string" ? v.lastIncrementalAt : null,
    lastWatermarkDate: typeof v.lastWatermarkDate === "string" ? v.lastWatermarkDate : null,
    lastError: typeof v.lastError === "string" ? v.lastError : null,
    defaultOrganizationKey: pickStr(v.defaultOrganizationKey),
    defaultRecipientOrganizationKey: pickStr(v.defaultRecipientOrganizationKey),
    defaultPriorityKey: pickStr(v.defaultPriorityKey),
    defaultAuthorKey: pickStr(v.defaultAuthorKey),
    defaultDepartmentKey: pickStr(v.defaultDepartmentKey),
    defaultResponsibleKey: pickStr(v.defaultResponsibleKey),
    defaultSourceWarehouseKey: pickStr(v.defaultSourceWarehouseKey),
    defaultTargetWarehouseKey: pickStr(v.defaultTargetWarehouseKey),
    defaultStatus: pickStr(v.defaultStatus) || DEFAULT_TRANSFER_HEADER.status,
    defaultOperation: pickStr(v.defaultOperation) || DEFAULT_TRANSFER_HEADER.operation,
    defaultDeliveryMethod: pickStr(v.defaultDeliveryMethod) || DEFAULT_TRANSFER_HEADER.deliveryMethod,
    defaultActivity: pickStr(v.defaultActivity) || DEFAULT_TRANSFER_HEADER.activity,
    defaultAcceptanceVariant: pickStr(v.defaultAcceptanceVariant) || DEFAULT_TRANSFER_HEADER.acceptanceVariant,
    defaultSupplyVariant: pickStr(v.defaultSupplyVariant) || DEFAULT_TRANSFER_HEADER.supplyVariant,
  }
}

export async function saveTransferSyncSettings(
  client: PoolClient,
  siteId: number,
  patch: Partial<TransferSyncSettings>
): Promise<TransferSyncSettings> {
  const current = await getTransferSyncSettings(client, siteId)
  const next: TransferSyncSettings = { ...current, ...patch }
  await client.query(
    `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (site_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
    [siteId, TRANSFER_SYNC_SETTING_KEY, JSON.stringify(next)]
  )
  return next
}

async function upsertErpCatalogRows(
  client: PoolClient,
  siteId: number,
  kind: ErpCatalogKind,
  rows: Record<string, unknown>[]
): Promise<number> {
  let saved = 0
  for (const raw of rows) {
    const refKey = pickStr(raw.Ref_Key)
    const name = pickStr(raw.Description, raw.Наименование, raw.DescriptionFull)
    const code = pickStr(raw.Code)
    if (!refKey) continue
    await client.query(
      `INSERT INTO wms_erp_catalogs (site_id, catalog_kind, ref_key, code, name, payload_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
       ON CONFLICT (site_id, catalog_kind, ref_key) DO UPDATE SET
         code = EXCLUDED.code,
         name = EXCLUDED.name,
         payload_json = EXCLUDED.payload_json,
         updated_at = now()`,
      [siteId, kind, refKey, code || null, name || null, JSON.stringify(stripEmptyOData(raw))]
    )
    saved += 1
  }
  return saved
}

async function listErpCatalogs(client: PoolClient, siteId: number): Promise<ErpTransferCatalogs> {
  await ensureTransferOrderTables(client)
  const r = await client.query<{ catalog_kind: ErpCatalogKind; ref_key: string; code: string | null; name: string | null }>(
    `SELECT catalog_kind, ref_key, code, name
     FROM wms_erp_catalogs
     WHERE site_id = $1
     ORDER BY name NULLS LAST, ref_key`,
    [siteId]
  )
  const catalogs = emptyErpCatalogs()
  const bucket: Record<ErpCatalogKind, ErpCatalogItem[]> = {
    organization: catalogs.organizations,
    priority: catalogs.priorities,
    user: catalogs.users,
    department: catalogs.departments,
  }
  for (const row of r.rows) {
    const list = bucket[row.catalog_kind]
    if (!list) continue
    list.push({
      kind: row.catalog_kind,
      refKey: row.ref_key,
      code: row.code || "",
      name: row.name || row.code || row.ref_key,
    })
  }
  return catalogs
}

export async function syncTransferCatalogsFromOneC(
  client: PoolClient,
  siteId: number
): Promise<{ catalogs: ErpTransferCatalogs; synced: Record<ErpCatalogKind, number> }> {
  await ensureTransferOrderTables(client)
  const oneC = await getOneCSettingsFromClient(client, siteId)
  if (!oneC.baseUrl.trim() || !oneC.login.trim()) {
    throw new Error("Сначала сохраните адрес и логин 1С ERP в Настройки → Интеграции")
  }
  const root = normalizeODataRoot(oneC.baseUrl)
  const synced: Record<ErpCatalogKind, number> = {
    organization: 0,
    priority: 0,
    user: 0,
    department: 0,
  }
  const jobs: Array<{ entity: string; kind: ErpCatalogKind }> = [
    { entity: "Catalog_Организации", kind: "organization" },
    { entity: "Catalog_Приоритеты", kind: "priority" },
    { entity: "Catalog_Пользователи", kind: "user" },
    { entity: "Catalog_СтруктураПредприятия", kind: "department" },
  ]
  for (const job of jobs) {
    try {
      const rows = await fetchCatalogPages(oneC, root, job.entity)
      synced[job.kind] = await upsertErpCatalogRows(client, siteId, job.kind, rows)
    } catch {
      synced[job.kind] = 0
    }
  }
  if (synced.department === 0) {
    try {
      const rows = await fetchCatalogPages(oneC, root, "Catalog_ПодразделенияОрганизаций")
      synced.department = await upsertErpCatalogRows(client, siteId, "department", rows)
    } catch {
      synced.department = 0
    }
  }
  return { catalogs: await listErpCatalogs(client, siteId), synced }
}

function catalogPageUrl(root: string, entity: string, top: number, skip: number, extra = ""): string {
  return `${root}/${entity}?$format=json&$inlinecount=allpages&$top=${top}&$skip=${skip}${extra}`
}

function odataDatetime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19)
  return d.toISOString().slice(0, 19)
}

function guessWmsWarehouseCode(name: string, code: string): string | null {
  const n = `${name} ${code}`.toLocaleLowerCase("ru")
  if (/(некондиц|карантин|котельн|тендер)/.test(n)) return null
  if (n.includes("гп скит") || (n.includes("готов") && n.includes("продук") && n.includes("скит"))) return "FG"
  if (n.includes("сырье скит") || n.includes("сырьё скит") || (n.includes("материал") && n.includes("скит"))) return "OS"
  if (n.includes("сериал") || n.includes("лини")) return "LINE"
  if (n.includes("гп владивосток") || (n.includes("владивосток") && n.includes("гп"))) return "FG-VVO"
  if (n.includes("гп хабаровск") || (n.includes("хабаровск") && n.includes("гп"))) return "FG-KHV"
  return null
}

function citySlugFromErpName(name: string): string {
  const n = name.toLocaleLowerCase("ru")
  if (n.includes("владивосток")) return "VVO"
  if (n.includes("хабаровск")) return "KHV"
  if (n.includes("скит")) return "SKIT"
  const ascii = name
    .replace(/[^A-Za-zА-Яа-я0-9]+/g, "")
    .slice(0, 8)
    .toUpperCase()
  return ascii || "EXT"
}

function warehouseCodeFromErpName(name: string): string {
  const guessed = guessWmsWarehouseCode(name, "")
  if (guessed) return guessed
  const n = name.toLocaleLowerCase("ru")
  const city = citySlugFromErpName(name)
  if (n.includes("некондиц")) return `NC-${city}`
  if (n.includes("гп") || n.includes("готов")) return `FG-${city}`
  if (n.includes("сырь")) return `OS-${city}`
  return `WH-${city}`
}

function warehouseTypeFromCode(code: string): string {
  if (code.startsWith("FG")) return "FINISHED_GOODS"
  if (code === "OS" || code.startsWith("OS-")) return "MAIN"
  if (code === "LINE" || code.startsWith("LINE")) return "PRODUCTION"
  return "MAIN"
}

async function fetchCatalogPages(
  settings: OneCSettings,
  root: string,
  entity: string
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let skip = 0
  let total = Number.POSITIVE_INFINITY
  let pages = 0
  while (skip < total) {
    const payload = asRecord(await oneCRequest(catalogPageUrl(root, entity, CATALOG_PAGE_SIZE, skip), settings, 45000))
    if (!payload) break
    const count = Number(payload["odata.count"] ?? payload["@odata.count"] ?? NaN)
    if (Number.isFinite(count)) total = count
    const batch = Array.isArray(payload.value) ? payload.value : []
    for (const item of batch) {
      const rec = asRecord(item)
      if (rec && rec.DeletionMark !== true && rec.IsFolder !== true) rows.push(rec)
    }
    pages += 1
    if (batch.length === 0) break
    skip += batch.length
    if (!Number.isFinite(count) && batch.length < CATALOG_PAGE_SIZE) break
    if (pages > 80) break
  }
  return rows
}

export async function syncWarehousesFromOneC(
  client: PoolClient,
  siteId: number,
  settings: OneCSettings
): Promise<{ warehousesSynced: number; defaults: Partial<TransferSyncSettings> }> {
  const root = normalizeODataRoot(settings.baseUrl)
  const warehouses = await fetchCatalogPages(settings, root, "Catalog_Склады")
  const wms = await client.query<{ warehouse_id: string; warehouse_code: string; name: string; meta_json: unknown }>(
    `SELECT warehouse_id::text, warehouse_code, name, meta_json FROM wms_warehouses WHERE site_id = $1 AND is_active`,
    [siteId]
  )
  const byCode = new Map(wms.rows.map((row) => [row.warehouse_code, row]))
  const byName = new Map(wms.rows.map((row) => [row.name.trim().toLocaleLowerCase("ru"), row]))

  let linked = 0
  for (const raw of warehouses) {
    const refKey = pickStr(raw.Ref_Key)
    const name = pickStr(raw.Description, raw.Наименование)
    const code = pickStr(raw.Code)
    if (!refKey) continue
    const guessed = guessWmsWarehouseCode(name, code)
    const wmsRow =
      wms.rows.find((row) => pickStr(jsonObject(row.meta_json).oneCGuid) === refKey) ||
      (guessed ? byCode.get(guessed) : undefined) ||
      byName.get(name.toLocaleLowerCase("ru")) ||
      null
    await client.query(
      `INSERT INTO wms_erp_warehouses (site_id, ref_key, code, name, wms_warehouse_id, payload_json, updated_at)
       VALUES ($1, $2, $3, $4, $5::bigint, $6::jsonb, now())
       ON CONFLICT (site_id, ref_key) DO UPDATE SET
         code = EXCLUDED.code,
         name = EXCLUDED.name,
         wms_warehouse_id = COALESCE(EXCLUDED.wms_warehouse_id, wms_erp_warehouses.wms_warehouse_id),
         payload_json = EXCLUDED.payload_json,
         updated_at = now()`,
      [siteId, refKey, code || null, name || null, wmsRow?.warehouse_id ?? null, JSON.stringify(stripEmptyOData(raw))]
    )
    if (wmsRow) {
      linked += 1
      const meta = jsonObject(wmsRow.meta_json)
      meta.oneCGuid = refKey
      if (code) meta.oneCCode = code
      if (name) meta.oneCName = name
      await client.query(`UPDATE wms_warehouses SET meta_json = $3::jsonb, updated_at = now() WHERE site_id = $1 AND warehouse_id = $2::bigint`, [
        siteId,
        wmsRow.warehouse_id,
        JSON.stringify(meta),
      ])
    }
  }

  const orgs = await fetchCatalogPages(settings, root, "Catalog_Организации").catch(() => [] as Record<string, unknown>[])
  if (orgs.length) await upsertErpCatalogRows(client, siteId, "organization", orgs)
  const defaults: Partial<TransferSyncSettings> = {}
  const firstOrg = orgs[0]
  if (firstOrg) defaults.defaultOrganizationKey = pickStr(firstOrg.Ref_Key)
  return { warehousesSynced: warehouses.length, defaults }
}

function goodsOf(payload: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(payload.Товары)
    ? payload.Товары.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => Boolean(row))
    : []
}

function shouldCreateTask(row: {
  posted: boolean
  deletionMark: boolean
  status: string
}): boolean {
  if (row.deletionMark) return false
  const status = row.status.trim().toLocaleLowerCase("ru")
  if (CLOSED_STATUSES.has(status)) return false
  if (row.posted) return true
  return status === "квыполнению" || status === "кобеспечению" || status === "согласован"
}

async function upsertTransferOrder(
  client: PoolClient,
  siteId: number,
  raw: Record<string, unknown>,
  warehouseNames: Map<string, string>
): Promise<{ upserted: boolean; refKey: string; open: boolean }> {
  const filled = asRecord(stripEmptyOData(raw)) ?? {}
  const refKey = pickStr(filled.Ref_Key, raw.Ref_Key)
  if (!refKey) return { upserted: false, refKey: "", open: false }
  const sourceKey = pickStr(filled.СкладОтправитель_Key, raw.СкладОтправитель_Key)
  const targetKey = pickStr(filled.СкладПолучатель_Key, raw.СкладПолучатель_Key)
  const status = pickStr(filled.Статус, raw.Статус)
  const posted = raw.Posted === true || filled.Posted === true
  const deletionMark = raw.DeletionMark === true || filled.DeletionMark === true
  const docDate = pickStr(filled.Date, raw.Date)
  await client.query(
    `INSERT INTO wms_erp_transfer_orders (
       site_id, ref_key, document_no, doc_date, posted, deletion_mark, status, operation, comment,
       source_warehouse_key, target_warehouse_key, organization_key,
       source_warehouse_name, target_warehouse_name, max_line_code,
       payload_json, created_from, last_data_version, last_seen_at
     ) VALUES (
       $1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15,
       $16::jsonb, '1c', $17, now()
     )
     ON CONFLICT (site_id, ref_key) DO UPDATE SET
       document_no = EXCLUDED.document_no,
       doc_date = EXCLUDED.doc_date,
       posted = EXCLUDED.posted,
       deletion_mark = EXCLUDED.deletion_mark,
       status = EXCLUDED.status,
       operation = EXCLUDED.operation,
       comment = EXCLUDED.comment,
       source_warehouse_key = EXCLUDED.source_warehouse_key,
       target_warehouse_key = EXCLUDED.target_warehouse_key,
       organization_key = EXCLUDED.organization_key,
       source_warehouse_name = EXCLUDED.source_warehouse_name,
       target_warehouse_name = EXCLUDED.target_warehouse_name,
       max_line_code = EXCLUDED.max_line_code,
       payload_json = EXCLUDED.payload_json,
       last_data_version = EXCLUDED.last_data_version,
       last_seen_at = now()`,
    [
      siteId,
      refKey,
      pickStr(filled.Number, raw.Number) || null,
      docDate || null,
      posted,
      deletionMark,
      status || null,
      pickStr(filled.ХозяйственнаяОперация, raw.ХозяйственнаяОперация) || null,
      pickStr(filled.Комментарий, raw.Комментарий) || null,
      sourceKey || null,
      targetKey || null,
      pickStr(filled.Организация_Key, raw.Организация_Key) || null,
      warehouseNames.get(sourceKey) || null,
      warehouseNames.get(targetKey) || null,
      pickStr(filled.МаксимальныйКодСтроки, raw.МаксимальныйКодСтроки) || null,
      JSON.stringify(filled),
      pickStr(raw.DataVersion, filled.DataVersion) || null,
    ]
  )
  return {
    upserted: true,
    refKey,
    open: shouldCreateTask({ posted, deletionMark, status }),
  }
}

async function resolveItemByOneCGuid(
  client: PoolClient,
  siteId: number,
  guid: string
): Promise<{ item_id: string; item_code: string; name: string } | null> {
  if (!guid) return null
  const r = await client.query<{ item_id: string; item_code: string; name: string }>(
    `SELECT item_id::text, item_code, name
     FROM wms_items
     WHERE site_id = $1
       AND (
         item_attrs_json #>> '{nomenclature,oneCGuid}' = $2
         OR item_code = $2
       )
     LIMIT 1`,
    [siteId, guid]
  )
  return r.rows[0] ?? null
}

async function ensureWmsWarehouseForErp(
  client: PoolClient,
  siteId: number,
  refKey: string
): Promise<string | null> {
  if (!refKey) return null
  const erp = await client.query<{
    name: string | null
    code: string | null
    warehouse_code: string | null
  }>(
    `SELECT e.name, e.code, w.warehouse_code
     FROM wms_erp_warehouses e
     LEFT JOIN wms_warehouses w ON w.warehouse_id = e.wms_warehouse_id
     WHERE e.site_id = $1 AND e.ref_key = $2`,
    [siteId, refKey]
  )
  const row = erp.rows[0]
  if (row?.warehouse_code) return row.warehouse_code
  const name = (row?.name || "").trim() || `Склад 1С ${refKey.slice(0, 8)}`
  const wanted = warehouseCodeFromErpName(name)
  const existing = await client.query<{ warehouse_id: string; warehouse_code: string }>(
    `SELECT warehouse_id::text, warehouse_code
     FROM wms_warehouses
     WHERE site_id = $1 AND (warehouse_code = $2 OR meta_json->>'oneCGuid' = $3)
     LIMIT 1`,
    [siteId, wanted, refKey]
  )
  let warehouseId = existing.rows[0]?.warehouse_id ?? null
  let warehouseCode = existing.rows[0]?.warehouse_code ?? wanted
  if (!warehouseId) {
    const created = await client.query<{ warehouse_id: string }>(
      `INSERT INTO wms_warehouses (
         site_id, warehouse_code, name, short_name, warehouse_type, status_code, is_active, meta_json
       ) VALUES (
         $1, $2, $3, $3, $4, 'ACTIVE', true, $5::jsonb
       )
       RETURNING warehouse_id::text`,
      [
        siteId,
        wanted,
        name,
        warehouseTypeFromCode(wanted),
        JSON.stringify({ oneCGuid: refKey, oneCName: name, oneCCode: row?.code || null }),
      ]
    )
    warehouseId = created.rows[0]?.warehouse_id ?? null
    warehouseCode = wanted
  }
  if (!warehouseId) return null
  await client.query(
    `UPDATE wms_erp_warehouses
     SET wms_warehouse_id = $3::bigint, updated_at = now()
     WHERE site_id = $1 AND ref_key = $2`,
    [siteId, refKey, warehouseId]
  )
  const zone = await client.query<{ zone_id: string }>(
    `INSERT INTO wms_zones (warehouse_id, zone_code, name, purpose, is_active)
     SELECT $1::bigint, 'RECV', 'Приёмка', 'receiving', true
     WHERE NOT EXISTS (
       SELECT 1 FROM wms_zones WHERE warehouse_id = $1::bigint AND zone_code = 'RECV'
     )
     RETURNING zone_id::text`,
    [warehouseId]
  )
  const zoneId =
    zone.rows[0]?.zone_id ??
    (
      await client.query<{ zone_id: string }>(
        `SELECT zone_id::text FROM wms_zones WHERE warehouse_id = $1::bigint AND zone_code = 'RECV' LIMIT 1`,
        [warehouseId]
      )
    ).rows[0]?.zone_id
  if (!zoneId) return warehouseCode
  const gateCode = `${warehouseCode}-IN`
  await client.query(
    `INSERT INTO wms_locations (site_id, warehouse_id, zone_id, location_code, display_name, location_status_id)
     SELECT $1, $2::bigint, $3::bigint, $4, $5, 1
     WHERE NOT EXISTS (
       SELECT 1 FROM wms_locations WHERE site_id = $1 AND location_code = $4
     )`,
    [siteId, warehouseId, zoneId, gateCode, `Приёмка ${name}`]
  )
  return warehouseCode
}

async function resolveWmsWarehouseCode(
  client: PoolClient,
  siteId: number,
  refKey: string
): Promise<string | null> {
  if (!refKey) return null
  const r = await client.query<{ warehouse_code: string }>(
    `SELECT w.warehouse_code
     FROM wms_erp_warehouses e
     JOIN wms_warehouses w ON w.warehouse_id = e.wms_warehouse_id
     WHERE e.site_id = $1 AND e.ref_key = $2
     UNION ALL
     SELECT warehouse_code
     FROM wms_warehouses
     WHERE site_id = $1 AND meta_json->>'oneCGuid' = $2
     LIMIT 1`,
    [siteId, refKey]
  )
  if (r.rows[0]?.warehouse_code) return r.rows[0].warehouse_code
  return ensureWmsWarehouseForErp(client, siteId, refKey)
}

async function defaultInboundLocationCode(
  client: PoolClient,
  siteId: number,
  warehouseCode: string | null | undefined
): Promise<string | undefined> {
  if (!warehouseCode) return undefined
  const r = await client.query<{ location_code: string }>(
    `SELECT location_code
     FROM wms_locations l
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
     WHERE l.site_id = $1 AND w.warehouse_code = $2
     ORDER BY CASE WHEN location_code = $2 || '-IN' THEN 0 ELSE 1 END, location_code
     LIMIT 1`,
    [siteId, warehouseCode]
  )
  return r.rows[0]?.location_code || undefined
}

async function findExistingWmsDocument(
  client: PoolClient,
  siteId: number,
  refKey: string
): Promise<string | null> {
  const r = await client.query<{ document_id: string }>(
    `SELECT document_id::text
     FROM wms_documents
     WHERE site_id = $1 AND (
       external_ref = $2
       OR payload_json->>'externalRef1c' = $2
       OR payload_json #>> '{erpTransfer,refKey}' = $2
     )
     LIMIT 1`,
    [siteId, refKey]
  )
  return r.rows[0]?.document_id ?? null
}

async function warehouseIdByCode(
  client: PoolClient,
  siteId: number,
  warehouseCode: string | null | undefined
): Promise<string | null> {
  if (!warehouseCode) return null
  const r = await client.query<{ warehouse_id: string }>(
    `SELECT warehouse_id::text FROM wms_warehouses WHERE site_id = $1 AND warehouse_code = $2 LIMIT 1`,
    [siteId, warehouseCode]
  )
  return r.rows[0]?.warehouse_id ?? null
}

async function locationIdByCode(
  client: PoolClient,
  siteId: number,
  locationCode: string | null | undefined
): Promise<string | null> {
  if (!locationCode) return null
  const r = await client.query<{ location_id: string }>(
    `SELECT location_id::text FROM wms_locations WHERE site_id = $1 AND location_code = $2 LIMIT 1`,
    [siteId, locationCode]
  )
  return r.rows[0]?.location_id ?? null
}

async function repairExistingTransferDocument(
  client: PoolClient,
  siteId: number,
  refKey: string,
  documentId: string
): Promise<void> {
  const order = await client.query<{
    source_warehouse_key: string | null
    target_warehouse_key: string | null
    source_warehouse_name: string | null
    target_warehouse_name: string | null
  }>(
    `SELECT source_warehouse_key, target_warehouse_key, source_warehouse_name, target_warehouse_name
     FROM wms_erp_transfer_orders
     WHERE site_id = $1 AND ref_key = $2`,
    [siteId, refKey]
  )
  const row = order.rows[0]
  if (!row) return

  const sourceWarehouseCode = await resolveWmsWarehouseCode(client, siteId, row.source_warehouse_key || "")
  const targetWarehouseCode = await resolveWmsWarehouseCode(client, siteId, row.target_warehouse_key || "")
  const targetLocationCode = await defaultInboundLocationCode(client, siteId, targetWarehouseCode)
  const sourceWarehouseId = await warehouseIdByCode(client, siteId, sourceWarehouseCode)
  const targetWarehouseId = await warehouseIdByCode(client, siteId, targetWarehouseCode)
  const targetLocationId = await locationIdByCode(client, siteId, targetLocationCode)
  const documentType =
    sourceWarehouseCode && targetWarehouseCode && sourceWarehouseCode !== targetWarehouseCode
      ? "interwarehouse_transfer"
      : "transfer"
  const taskType = documentType === "interwarehouse_transfer" ? "interwarehouse_transfer" : "transfer"

  await client.query(
    `UPDATE wms_documents d
     SET source_warehouse_id = COALESCE($3::bigint, d.source_warehouse_id),
         target_warehouse_id = COALESCE($4::bigint, d.target_warehouse_id),
         target_location_id = COALESCE($5::bigint, d.target_location_id),
         document_type_id = COALESCE(
           (SELECT document_type_id FROM ref_wms_document_type WHERE code = $6),
           d.document_type_id
         ),
         payload_json = jsonb_set(
           COALESCE(d.payload_json, '{}'::jsonb),
           '{erpTransfer}',
           COALESCE(d.payload_json->'erpTransfer', '{}'::jsonb) || $7::jsonb
         )
     WHERE d.site_id = $1 AND d.document_id = $2::bigint`,
    [
      siteId,
      documentId,
      sourceWarehouseId,
      targetWarehouseId,
      targetLocationId,
      documentType,
      JSON.stringify({
        refKey,
        sourceWarehouseName: row.source_warehouse_name || null,
        targetWarehouseName: row.target_warehouse_name || null,
        sourceWarehouseCode,
        targetWarehouseCode,
      }),
    ]
  )
  await client.query(
    `UPDATE wms_tasks t
     SET source_warehouse_id = COALESCE($3::bigint, t.source_warehouse_id),
         target_warehouse_id = COALESCE($4::bigint, t.target_warehouse_id),
         target_location_id = COALESCE($5::bigint, t.target_location_id),
         task_type_id = COALESCE(
           (SELECT task_type_id FROM ref_wms_task_type WHERE code = $6),
           t.task_type_id
         ),
         updated_at = now()
     WHERE t.site_id = $1 AND t.document_id = $2::bigint
       AND t.completed_at IS NULL`,
    [siteId, documentId, sourceWarehouseId, targetWarehouseId, targetLocationId, taskType]
  )
}

async function createWmsTasksForOrder(
  client: PoolClient,
  siteId: number,
  refKey: string
): Promise<{ created: boolean; unmatchedLines: number }> {
  const order = await client.query<{
    wms_document_id: string | null
    document_no: string | null
    comment: string | null
    source_warehouse_key: string | null
    target_warehouse_key: string | null
    source_warehouse_name: string | null
    target_warehouse_name: string | null
    payload_json: unknown
  }>(
    `SELECT wms_document_id::text, document_no, comment, source_warehouse_key, target_warehouse_key,
            source_warehouse_name, target_warehouse_name, payload_json
     FROM wms_erp_transfer_orders
     WHERE site_id = $1 AND ref_key = $2`,
    [siteId, refKey]
  )
  const row = order.rows[0]
  if (!row) return { created: false, unmatchedLines: 0 }
  const existing = row.wms_document_id || (await findExistingWmsDocument(client, siteId, refKey))
  if (existing) {
    await client.query(
      `UPDATE wms_erp_transfer_orders SET wms_document_id = $3::bigint WHERE site_id = $1 AND ref_key = $2`,
      [siteId, refKey, existing]
    )
    await repairExistingTransferDocument(client, siteId, refKey, existing)
    return { created: false, unmatchedLines: 0 }
  }

  const payload = asRecord(row.payload_json) ?? {}
  const goods = goodsOf(payload).filter((line) => line.Отменено !== true)
  const lines: Array<{
    itemCode: string
    qty: number
    comment?: string
    taskPayload?: Record<string, unknown>
  }> = []
  let unmatchedLines = 0
  for (const line of goods) {
    const guid = pickStr(line.Номенклатура_Key)
    const item = await resolveItemByOneCGuid(client, siteId, guid)
    const qty = Number(line.Количество ?? line.КоличествоУпаковок ?? 0)
    if (!item || !Number.isFinite(qty) || qty <= 0) {
      unmatchedLines += 1
      continue
    }
    lines.push({
      itemCode: item.item_code,
      qty,
      comment: pickStr(line.Комментарий) || undefined,
      taskPayload: { erpLine: stripEmptyOData(line) },
    })
  }
  if (lines.length === 0) return { created: false, unmatchedLines }

  const sourceWarehouseCode = await resolveWmsWarehouseCode(client, siteId, row.source_warehouse_key || "")
  const targetWarehouseCode = await resolveWmsWarehouseCode(client, siteId, row.target_warehouse_key || "")
  const targetLocationCode = await defaultInboundLocationCode(client, siteId, targetWarehouseCode)
  const documentType =
    sourceWarehouseCode && targetWarehouseCode && sourceWarehouseCode !== targetWarehouseCode
      ? "interwarehouse_transfer"
      : "transfer"

  const created = await createDocumentWithTasks(client, siteId, {
    requestId: randomUUID(),
    siteCode: "",
    documentType,
    sourceWarehouseCode: sourceWarehouseCode || undefined,
    targetWarehouseCode: targetWarehouseCode || undefined,
    targetLocationCode,
    documentNo: row.document_no || undefined,
    externalRef: refKey,
    comment: row.comment || `Заказ на перемещение 1С ${row.document_no || refKey}`,
    lines,
  })

  await client.query(
    `UPDATE wms_documents
     SET external_ref = $2,
         payload_json = COALESCE(payload_json, '{}'::jsonb) || $3::jsonb
     WHERE document_id = $1::bigint`,
    [
      created.documentId,
      refKey,
      JSON.stringify({
        erpTransfer: {
          refKey,
          number: row.document_no,
          source: "1c",
          sourceWarehouseName: row.source_warehouse_name || null,
          targetWarehouseName: row.target_warehouse_name || null,
          sourceWarehouseCode,
          targetWarehouseCode,
          payload,
        },
      }),
    ]
  )
  await client.query(
    `UPDATE wms_erp_transfer_orders SET wms_document_id = $3::bigint WHERE site_id = $1 AND ref_key = $2`,
    [siteId, refKey, created.documentId]
  )
  return { created: true, unmatchedLines }
}

async function fetchTransferPage(
  settings: OneCSettings,
  root: string,
  skip: number,
  filter = ""
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const extra = filter ? `&$filter=${encodeURI(filter).replace(/%24/g, "$")}` : ""
  const url = catalogPageUrl(root, ENTITY, DOC_PAGE_SIZE, skip, extra)
  const payload = asRecord(await oneCRequest(url, settings, 60000))
  if (!payload) throw new Error("1С вернула пустой ответ заказов на перемещение")
  const total = Number(payload["odata.count"] ?? payload["@odata.count"] ?? NaN)
  const batch = Array.isArray(payload.value) ? payload.value : []
  return {
    rows: batch.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item)),
    total: Number.isFinite(total) ? total : skip + batch.length,
  }
}

function rememberDefaults(settings: TransferSyncSettings, raw: Record<string, unknown>): Partial<TransferSyncSettings> {
  const patch: Partial<TransferSyncSettings> = {}
  if (!settings.defaultOrganizationKey) patch.defaultOrganizationKey = pickStr(raw.Организация_Key)
  if (!settings.defaultPriorityKey) patch.defaultPriorityKey = pickStr(raw.Приоритет_Key)
  if (!settings.defaultAuthorKey) patch.defaultAuthorKey = pickStr(raw.Автор_Key)
  if (!settings.defaultDepartmentKey) patch.defaultDepartmentKey = pickStr(raw.Подразделение_Key)
  if (!settings.defaultResponsibleKey) patch.defaultResponsibleKey = pickStr(raw.Ответственный_Key)
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => Boolean(value))) as Partial<TransferSyncSettings>
}

export async function syncTransferOrdersFromOneC(
  client: PoolClient,
  siteId: number,
  input: { mode: "full" | "incremental"; skip?: number; siteCode?: string }
): Promise<TransferSyncResult> {
  const fromPool = await getOneCSettings(input.siteCode || "DEFAULT")
  const oneC = fromPool.baseUrl.trim() ? fromPool : await getOneCSettingsFromClient(client, siteId)
  if (!oneC.baseUrl.trim() || !oneC.login.trim()) {
    throw new Error("Сначала сохраните адрес и логин 1С ERP в Настройки → Интеграции")
  }

  await ensureTransferOrderTables(client)
  const sync = await getTransferSyncSettings(client, siteId)
  const root = normalizeODataRoot(oneC.baseUrl)
  let warehousesSynced = 0
  if ((input.skip ?? 0) === 0) {
    try {
      const catalog = await syncWarehousesFromOneC(client, siteId, oneC)
      warehousesSynced = catalog.warehousesSynced
      if (Object.keys(catalog.defaults).length) {
        await saveTransferSyncSettings(client, siteId, catalog.defaults)
      }
    } catch {
      warehousesSynced = 0
    }
  }

  const names = await client.query<{ ref_key: string; name: string | null }>(
    `SELECT ref_key, name FROM wms_erp_warehouses WHERE site_id = $1`,
    [siteId]
  )
  const warehouseNames = new Map(names.rows.map((row) => [row.ref_key, row.name || ""]))

  let filter = ""
  if (input.mode === "incremental") {
    const watermark = sync.lastWatermarkDate || new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
    filter = `Date ge datetime'${odataDatetime(watermark)}'`
  }

  let skip = Math.max(0, Math.trunc(input.skip ?? 0))
  let fetched = 0
  let pages = 0
  let upserted = 0
  let tasksCreated = 0
  let skippedClosed = 0
  let unmatchedLines = 0
  let totalIn1C = 0
  let latestDate = sync.lastWatermarkDate
  const liveSync = await getTransferSyncSettings(client, siteId)

  const pageBudget = input.mode === "full" ? FULL_PAGES_PER_CALL : 20
  while (pages < pageBudget) {
    let page: { rows: Record<string, unknown>[]; total: number }
    try {
      page = await fetchTransferPage(oneC, root, skip, filter)
    } catch (error) {
      if (!filter) throw error
      filter = ""
      page = await fetchTransferPage(oneC, root, skip, "")
    }
    totalIn1C = page.total
    if (page.rows.length === 0) break
    for (const raw of page.rows) {
      const saved = await upsertTransferOrder(client, siteId, raw, warehouseNames)
      if (!saved.upserted) continue
      upserted += 1
      const defaults = rememberDefaults(liveSync, raw)
      if (Object.keys(defaults).length) Object.assign(liveSync, defaults)
      const docDate = pickStr(raw.Date)
      if (docDate && (!latestDate || docDate > latestDate)) latestDate = docDate
      if (saved.open) {
        const created = await createWmsTasksForOrder(client, siteId, saved.refKey)
        if (created.created) tasksCreated += 1
        unmatchedLines += created.unmatchedLines
      } else {
        skippedClosed += 1
      }
    }
    fetched += page.rows.length
    pages += 1
    skip += page.rows.length
    if (page.rows.length < DOC_PAGE_SIZE) break
    if (skip >= page.total) break
  }

  const done = skip >= totalIn1C || pages === 0 || (input.mode === "incremental" && pages < pageBudget)
  const patch: Partial<TransferSyncSettings> = {
    lastError: null,
    lastWatermarkDate: latestDate,
    defaultOrganizationKey: liveSync.defaultOrganizationKey,
    defaultPriorityKey: liveSync.defaultPriorityKey,
    defaultAuthorKey: liveSync.defaultAuthorKey,
    defaultDepartmentKey: liveSync.defaultDepartmentKey,
    defaultResponsibleKey: liveSync.defaultResponsibleKey,
  }
  if (input.mode === "full" && done) patch.lastFullSyncAt = new Date().toISOString()
  if (input.mode === "incremental") patch.lastIncrementalAt = new Date().toISOString()
  await saveTransferSyncSettings(client, siteId, patch)

  return {
    ok: true,
    mode: input.mode,
    done,
    nextSkip: done ? 0 : skip,
    totalIn1C,
    fetched,
    pages,
    upserted,
    tasksCreated,
    warehousesSynced,
    skippedClosed,
    unmatchedLines,
  }
}

async function getOneCSettingsFromClient(client: PoolClient, siteId: number): Promise<OneCSettings> {
  const r = await client.query<{ setting_value: unknown }>(
    `SELECT setting_value FROM wms_app_settings WHERE site_id = $1 AND setting_key = 'integration_1c_erp'`,
    [siteId]
  )
  const v = jsonObject(r.rows[0]?.setting_value)
  return {
    enabled: v.enabled === true,
    baseUrl: typeof v.baseUrl === "string" ? v.baseUrl : "",
    login: typeof v.login === "string" ? v.login : "",
    password: typeof v.password === "string" ? v.password : "",
    viaFactory: v.viaFactory !== false,
  }
}

export async function listErpTransferOrders(
  client: PoolClient,
  siteId: number,
  options?: { query?: string; limit?: number; onlyOpen?: boolean }
): Promise<{
  orders: ErpTransferOrderRow[]
  warehouses: ErpWarehouse[]
  catalogs: ErpTransferCatalogs
  defaults: TransferSyncSettings
  counts: { total: number; open: number; withTasks: number }
}> {
  await ensureTransferOrderTables(client)
  const limit = Math.min(100, Math.max(1, options?.limit ?? 40))
  const query = options?.query?.trim() ?? ""
  const onlyOpen = options?.onlyOpen === true
  const orders = await client.query<{
    ref_key: string
    document_no: string | null
    doc_date: string | null
    posted: boolean
    deletion_mark: boolean
    status: string | null
    operation: string | null
    comment: string | null
    source_warehouse_key: string | null
    target_warehouse_key: string | null
    source_warehouse_name: string | null
    target_warehouse_name: string | null
    organization_key: string | null
    wms_document_id: string | null
    created_from: string
    last_seen_at: string
    payload_json: unknown
  }>(
    `SELECT
       ref_key, document_no, doc_date::text, posted, deletion_mark, status, operation, comment,
       source_warehouse_key, target_warehouse_key, source_warehouse_name, target_warehouse_name,
       organization_key, wms_document_id::text, created_from, last_seen_at::text, payload_json
     FROM wms_erp_transfer_orders
     WHERE site_id = $1
       AND ($2::text = '' OR document_no ILIKE '%' || $2 || '%' OR COALESCE(comment,'') ILIKE '%' || $2 || '%' OR ref_key ILIKE '%' || $2 || '%')
       AND (
         NOT $3::boolean
         OR (
           deletion_mark = FALSE
           AND lower(COALESCE(status, '')) NOT IN ('закрыт', 'отменен', 'отменён', 'аннулирован')
         )
       )
     ORDER BY doc_date DESC NULLS LAST, last_seen_at DESC
     LIMIT $4`,
    [siteId, query, onlyOpen, limit]
  )
  const warehouses = await client.query<{
    ref_key: string
    code: string | null
    name: string | null
    warehouse_code: string | null
  }>(
    `SELECT e.ref_key, e.code, e.name, w.warehouse_code
     FROM wms_erp_warehouses e
     LEFT JOIN wms_warehouses w ON w.warehouse_id = e.wms_warehouse_id
     WHERE e.site_id = $1
     ORDER BY e.name`,
    [siteId]
  )
  const counts = await client.query<{ total: number; open: number; with_tasks: number }>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (
         WHERE deletion_mark = FALSE
           AND lower(COALESCE(status, '')) NOT IN ('закрыт', 'отменен', 'отменён', 'аннулирован')
       )::int AS open,
       COUNT(*) FILTER (WHERE wms_document_id IS NOT NULL)::int AS with_tasks
     FROM wms_erp_transfer_orders
     WHERE site_id = $1`,
    [siteId]
  )
  return {
    orders: orders.rows.map((row) => {
      const payload = asRecord(row.payload_json) ?? {}
      return {
        refKey: row.ref_key,
        documentNo: row.document_no || "",
        docDate: row.doc_date,
        posted: row.posted,
        deletionMark: row.deletion_mark,
        status: row.status || "",
        operation: row.operation || "",
        comment: row.comment || "",
        sourceWarehouseKey: row.source_warehouse_key || "",
        targetWarehouseKey: row.target_warehouse_key || "",
        sourceWarehouseName: row.source_warehouse_name || "",
        targetWarehouseName: row.target_warehouse_name || "",
        organizationKey: row.organization_key || "",
        lineCount: goodsOf(payload).length,
        wmsDocumentId: row.wms_document_id,
        createdFrom: row.created_from,
        lastSeenAt: row.last_seen_at,
        payload,
      }
    }),
    warehouses: warehouses.rows.map((row) => ({
      refKey: row.ref_key,
      code: row.code || "",
      name: row.name || row.code || row.ref_key,
      wmsCode: row.warehouse_code,
    })),
    catalogs: await listErpCatalogs(client, siteId),
    defaults: await getTransferSyncSettings(client, siteId),
    counts: {
      total: counts.rows[0]?.total ?? 0,
      open: counts.rows[0]?.open ?? 0,
      withTasks: counts.rows[0]?.with_tasks ?? 0,
    },
  }
}

function oneCNow(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`
}

export async function createTransferOrderInOneCAndWms(
  client: PoolClient,
  siteId: number,
  input: CreateErpTransferInput
): Promise<{
  refKey: string
  documentNo: string
  wmsDocumentId: string
  taskCount: number
  oneC: Record<string, unknown>
}> {
  if (!input.sourceWarehouseKey || !input.targetWarehouseKey) {
    throw new Error("Укажите склад-отправитель и склад-получатель")
  }
  if (input.sourceWarehouseKey === input.targetWarehouseKey) {
    throw new Error("Склады отправителя и получателя должны отличаться")
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("Добавьте хотя бы одну строку номенклатуры")
  }

  await ensureTransferOrderTables(client)
  const oneC = await getOneCSettingsFromClient(client, siteId)
  if (!oneC.baseUrl.trim() || !oneC.login.trim()) {
    throw new Error("Сначала сохраните адрес и логин 1С ERP в Настройки → Интеграции")
  }
  const sync = await getTransferSyncSettings(client, siteId)
  const organizationKey = pickStr(input.organizationKey, sync.defaultOrganizationKey)
  if (!organizationKey) {
    throw new Error("Нет организации 1С. Откройте Настройка в конструкторе и укажите организацию, либо выгрузите справочники ERP.")
  }
  const recipientOrganizationKey = pickStr(input.recipientOrganizationKey, sync.defaultRecipientOrganizationKey)
  const priorityKey = pickStr(input.priorityKey, sync.defaultPriorityKey)
  const authorKey = pickStr(input.authorKey, sync.defaultAuthorKey)
  const departmentKey = pickStr(input.departmentKey, sync.defaultDepartmentKey)
  const responsibleKey = pickStr(input.responsibleKey, sync.defaultResponsibleKey)
  const status = pickStr(input.status, sync.defaultStatus) || DEFAULT_TRANSFER_HEADER.status
  const operation = pickStr(input.operation, sync.defaultOperation) || DEFAULT_TRANSFER_HEADER.operation
  const deliveryMethod = pickStr(input.deliveryMethod, sync.defaultDeliveryMethod) || DEFAULT_TRANSFER_HEADER.deliveryMethod
  const activity = pickStr(input.activity, sync.defaultActivity) || DEFAULT_TRANSFER_HEADER.activity
  const acceptanceVariant =
    pickStr(input.acceptanceVariant, sync.defaultAcceptanceVariant) || DEFAULT_TRANSFER_HEADER.acceptanceVariant
  const supplyVariant = pickStr(input.supplyVariant, sync.defaultSupplyVariant) || DEFAULT_TRANSFER_HEADER.supplyVariant

  const date = oneCNow()
  const goods: Record<string, unknown>[] = []
  const wmsLines: Array<{ itemCode: string; qty: number; taskPayload?: Record<string, unknown> }> = []
  for (const [index, line] of input.lines.entries()) {
    const qty = Number(line.qty)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Строка ${index + 1}: укажите количество`)
    let nomenclatureKey = pickStr(line.nomenclatureKey)
    if (!nomenclatureKey) {
      const found = await client.query<{ guid: string | null }>(
        `SELECT item_attrs_json #>> '{nomenclature,oneCGuid}' AS guid
         FROM wms_items WHERE site_id = $1 AND item_code = $2 LIMIT 1`,
        [siteId, line.itemCode]
      )
      nomenclatureKey = pickStr(found.rows[0]?.guid)
    }
    if (!nomenclatureKey) {
      throw new Error(`У позиции ${line.itemCode} нет GUID 1С — сначала выгрузите номенклатуру из ERP`)
    }
    const row = {
      LineNumber: String(index + 1),
      КодСтроки: String(index + 1),
      Номенклатура_Key: nomenclatureKey,
      Количество: qty,
      КоличествоУпаковок: qty,
      ВариантОбеспечения: supplyVariant,
      НачалоОтгрузки: date,
      ОкончаниеПоступления: date,
      Отменено: false,
      ПодлежитРазблокировке: true,
    }
    goods.push(row)
    wmsLines.push({ itemCode: line.itemCode, qty, taskPayload: { erpLine: row } })
  }

  const body: Record<string, unknown> = {
    Date: date,
    Комментарий: pickStr(input.comment),
    Организация_Key: organizationKey,
    СкладОтправитель_Key: input.sourceWarehouseKey,
    СкладПолучатель_Key: input.targetWarehouseKey,
    Статус: status,
    ХозяйственнаяОперация: operation,
    СпособДоставки: deliveryMethod,
    ПеремещениеПодДеятельность: activity,
    ВариантПриемкиТоваров: acceptanceVariant,
    МаксимальныйКодСтроки: String(goods.length),
    Товары: goods,
  }
  if (recipientOrganizationKey) body.ОрганизацияПолучатель_Key = recipientOrganizationKey
  if (priorityKey) body.Приоритет_Key = priorityKey
  if (authorKey) body.Автор_Key = authorKey
  if (responsibleKey) body.Ответственный_Key = responsibleKey
  if (departmentKey) body.Подразделение_Key = departmentKey

  const root = normalizeODataRoot(oneC.baseUrl)
  const created = asRecord(
    await oneCRequest(`${root}/${ENTITY}?$format=json`, oneC, 60000, 0, { method: "POST", body: stripEmptyOData(body) })
  )
  if (!created) throw new Error("1С не вернула созданный заказ на перемещение")
  const refKey = pickStr(created.Ref_Key)
  const documentNo = pickStr(created.Number)
  if (!refKey) throw new Error("1С создала документ без Ref_Key")

  const names = await client.query<{ ref_key: string; name: string | null }>(
    `SELECT ref_key, name FROM wms_erp_warehouses WHERE site_id = $1`,
    [siteId]
  )
  await upsertTransferOrder(client, siteId, created, new Map(names.rows.map((row) => [row.ref_key, row.name || ""])))
  await client.query(
    `UPDATE wms_erp_transfer_orders SET created_from = 'wms' WHERE site_id = $1 AND ref_key = $2`,
    [siteId, refKey]
  )

  const sourceWarehouseCode = await resolveWmsWarehouseCode(client, siteId, input.sourceWarehouseKey)
  const targetWarehouseCode = await resolveWmsWarehouseCode(client, siteId, input.targetWarehouseKey)
  const targetLocationCode = await defaultInboundLocationCode(client, siteId, targetWarehouseCode)
  const documentType =
    sourceWarehouseCode && targetWarehouseCode && sourceWarehouseCode !== targetWarehouseCode
      ? "interwarehouse_transfer"
      : "transfer"
  const wms = await createDocumentWithTasks(client, siteId, {
    requestId: input.requestId || randomUUID(),
    siteCode: "",
    documentType,
    sourceWarehouseCode: sourceWarehouseCode || undefined,
    targetWarehouseCode: targetWarehouseCode || undefined,
    targetLocationCode,
    documentNo: documentNo || undefined,
    externalRef: refKey,
    comment: pickStr(input.comment) || `Заказ на перемещение 1С ${documentNo || refKey}`,
    lines: wmsLines,
  })
  await client.query(
    `UPDATE wms_documents
     SET external_ref = $2,
         payload_json = COALESCE(payload_json, '{}'::jsonb) || $3::jsonb
     WHERE document_id = $1::bigint`,
    [
      wms.documentId,
      refKey,
      JSON.stringify({
        erpTransfer: {
          refKey,
          number: documentNo,
          source: "wms",
          sourceWarehouseName: names.rows.find((row) => row.ref_key === input.sourceWarehouseKey)?.name || null,
          targetWarehouseName: names.rows.find((row) => row.ref_key === input.targetWarehouseKey)?.name || null,
          sourceWarehouseCode,
          targetWarehouseCode,
          payload: stripEmptyOData(created),
        },
      }),
    ]
  )
  await client.query(
    `UPDATE wms_erp_transfer_orders SET wms_document_id = $3::bigint WHERE site_id = $1 AND ref_key = $2`,
    [siteId, refKey, wms.documentId]
  )

  return {
    refKey,
    documentNo,
    wmsDocumentId: wms.documentId,
    taskCount: wms.taskCount,
    oneC: asRecord(stripEmptyOData(created)) ?? created,
  }
}
