import { randomUUID } from "crypto"
import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"
import { createCodeList } from "@/lib/wms/code-lists"
import { resolveItemByCodeOrBarcode } from "@/lib/wms/resolve"
import { ensureTorg1Tables } from "@/lib/wms/torg1"
import {
  DEFAULT_RECEIVING_SITE_RULES,
  parseReceivingSiteRules,
  type ReceivingSiteRules,
} from "@/lib/receiving-scan-policy"

export const RECEIVING_RULES_KEY = "receiving"

export type ReceivingLineSplit = {
  locationCode: string
  qty: number
  lpnCode: string
  lpnKind: "" | "pallet" | "box"
}

export type ReceivingInboundLine = {
  itemCode: string
  itemName: string
  expectedQty: number
  lotCode: string
  targetLocationCode: string
  splits: ReceivingLineSplit[]
}

export function parseReceivingSplits(raw: unknown): ReceivingLineSplit[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null
      const r = row as Record<string, unknown>
      const locationCode = String(r.locationCode ?? "").trim()
      const qty = Number(r.qty)
      if (!locationCode || !Number.isFinite(qty) || qty <= 0) return null
      const kind = r.lpnKind === "pallet" || r.lpnKind === "box" ? r.lpnKind : ""
      return {
        locationCode,
        qty,
        lpnCode: String(r.lpnCode ?? "").trim(),
        lpnKind: kind,
      } satisfies ReceivingLineSplit
    })
    .filter((row): row is ReceivingLineSplit => Boolean(row))
}

export type ReceivingInboundOrder = {
  documentId: string
  supplier: string
  expectedBatch: string
  comment: string
  lines: ReceivingInboundLine[]
  updatedAt: string | null
}

export async function loadReceivingSiteRules(
  client: PoolClient,
  siteId: number
): Promise<ReceivingSiteRules> {
  await ensureTorg1Tables(client)
  const r = await client.query<{ setting_value: unknown }>(
    `SELECT setting_value FROM wms_app_settings WHERE site_id = $1 AND setting_key = $2`,
    [siteId, RECEIVING_RULES_KEY]
  )
  if (!r.rows[0]) {
    return saveReceivingSiteRules(client, siteId, DEFAULT_RECEIVING_SITE_RULES)
  }
  return parseReceivingSiteRules(r.rows[0].setting_value)
}

export async function saveReceivingSiteRules(
  client: PoolClient,
  siteId: number,
  rules: ReceivingSiteRules
): Promise<ReceivingSiteRules> {
  await ensureTorg1Tables(client)
  const parsed = parseReceivingSiteRules(rules)
  await client.query(
    `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (site_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
    [siteId, RECEIVING_RULES_KEY, JSON.stringify(parsed)]
  )
  return parsed
}

async function ensureInboundTables(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_receiving_inbound (
      inbound_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      document_id TEXT NOT NULL,
      supplier TEXT,
      expected_batch TEXT,
      comment TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (site_id, document_id)
    )`)
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_receiving_inbound_lines (
      line_id BIGSERIAL PRIMARY KEY,
      inbound_id BIGINT NOT NULL REFERENCES wms_receiving_inbound(inbound_id) ON DELETE CASCADE,
      item_code TEXT NOT NULL,
      item_name TEXT,
      expected_qty NUMERIC NOT NULL DEFAULT 0,
      lot_code TEXT,
      target_location_code TEXT
    )`)
  await client.query(
    `ALTER TABLE wms_receiving_inbound_lines ADD COLUMN IF NOT EXISTS splits jsonb`
  )
}

export async function getReceivingInbound(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<ReceivingInboundOrder | null> {
  await ensureInboundTables(client)
  const doc = documentId.trim().toUpperCase()
  const head = await client.query<{
    inbound_id: string
    supplier: string | null
    expected_batch: string | null
    comment: string | null
    updated_at: string
  }>(
    `SELECT inbound_id::text, supplier, expected_batch, comment, updated_at::text
     FROM wms_receiving_inbound WHERE site_id = $1 AND document_id = $2`,
    [siteId, doc]
  )
  const row = head.rows[0]
  if (!row) return null
  const lines = await client.query<{
    item_code: string
    item_name: string | null
    expected_qty: string
    lot_code: string | null
    target_location_code: string | null
    splits: unknown
  }>(
    `SELECT item_code, item_name, expected_qty::text, lot_code, target_location_code, splits
     FROM wms_receiving_inbound_lines WHERE inbound_id = $1::bigint ORDER BY line_id`,
    [row.inbound_id]
  )
  return {
    documentId: doc,
    supplier: row.supplier ?? "",
    expectedBatch: row.expected_batch ?? "",
    comment: row.comment ?? "",
    updatedAt: row.updated_at,
    lines: lines.rows.map((line) => ({
      itemCode: line.item_code,
      itemName: line.item_name ?? "",
      expectedQty: Number(line.expected_qty) || 0,
      lotCode: line.lot_code ?? "",
      targetLocationCode: line.target_location_code ?? "",
      splits: parseReceivingSplits(line.splits),
    })),
  }
}

export async function saveReceivingInbound(
  client: PoolClient,
  siteId: number,
  input: {
    documentId: string
    supplier?: string
    expectedBatch?: string
    comment?: string
    lines?: ReceivingInboundLine[]
  }
): Promise<ReceivingInboundOrder> {
  await ensureInboundTables(client)
  const doc = input.documentId.trim().toUpperCase()
  if (!doc) throw new WmsHttpError(400, "documentId is required", "bad_document_id")
  const upsert = await client.query<{ inbound_id: string; updated_at: string }>(
    `INSERT INTO wms_receiving_inbound (site_id, document_id, supplier, expected_batch, comment, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (site_id, document_id)
     DO UPDATE SET
       supplier = EXCLUDED.supplier,
       expected_batch = EXCLUDED.expected_batch,
       comment = EXCLUDED.comment,
       updated_at = now()
     RETURNING inbound_id::text, updated_at::text`,
    [siteId, doc, input.supplier?.trim() || null, input.expectedBatch?.trim() || null, input.comment?.trim() || null]
  )
  const inboundId = upsert.rows[0].inbound_id
  await client.query(`DELETE FROM wms_receiving_inbound_lines WHERE inbound_id = $1::bigint`, [inboundId])
  const lines = input.lines ?? []
  for (const line of lines) {
    const itemCode = line.itemCode.trim()
    if (!itemCode) continue
    const splits = parseReceivingSplits(line.splits)
    await client.query(
      `INSERT INTO wms_receiving_inbound_lines
        (inbound_id, item_code, item_name, expected_qty, lot_code, target_location_code, splits)
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        inboundId,
        itemCode,
        line.itemName.trim() || null,
        Math.max(0, Number(line.expectedQty) || 0),
        line.lotCode.trim() || null,
        (splits[0]?.locationCode || line.targetLocationCode).trim() || null,
        JSON.stringify(splits),
      ]
    )
  }
  const saved = await getReceivingInbound(client, siteId, doc)
  if (!saved) throw new WmsHttpError(500, "Не удалось сохранить заказ на приход", "inbound_save_failed")
  return saved
}

async function attachBarcode(
  client: PoolClient,
  itemId: string,
  barcode: string,
  barcodeType: string
) {
  await client.query(
    `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
     VALUES ($1::bigint, $2, $3, FALSE, now())
     ON CONFLICT (barcode) DO UPDATE SET item_id = EXCLUDED.item_id`,
    [itemId, barcode, barcodeType]
  )
}

export async function createMissingItemCard(
  client: PoolClient,
  siteId: number,
  input: { code: string; name?: string; itemCode?: string }
): Promise<{ itemCode: string; name: string }> {
  const raw = input.code.trim()
  if (!raw) throw new WmsHttpError(400, "Нет кода для карточки", "missing_code")
  const gtin = raw.replace(/\D/g, "").slice(0, 14)
  const itemCode = (input.itemCode || (gtin.length >= 8 ? gtin : `UNK-${raw.replace(/\s+/g, "").slice(-12)}`)).trim()
  const name = (input.name || `Новая позиция ${itemCode}`).trim()
  const existing = await resolveItemByCodeOrBarcode(client, siteId, itemCode)
  if (existing) {
    if (gtin.length >= 8) await attachBarcode(client, existing.item_id, gtin, "gtin")
    return { itemCode: existing.item_code, name: existing.name }
  }
  await client.query(
    `INSERT INTO wms_items (
       site_id, item_code, sku, name, material_type, product_group, item_group_code,
       item_type_code, uom_code, is_marked, is_active, created_at, updated_at
     ) VALUES (
       $1, $2, $2, $3, 'Приёмка', 'unmarked', 'unmarked',
       'goods', 'pcs', FALSE, TRUE, now(), now()
     )
     ON CONFLICT (site_id, item_code) DO UPDATE SET
       name = COALESCE(NULLIF(EXCLUDED.name, ''), wms_items.name),
       updated_at = now()`,
    [siteId, itemCode, name]
  )
  const item = await resolveItemByCodeOrBarcode(client, siteId, itemCode)
  if (!item) throw new WmsHttpError(500, "Не удалось создать карточку", "item_create_failed")
  if (gtin.length >= 8) await attachBarcode(client, item.item_id, gtin, "gtin")
  else if (raw && raw !== itemCode) await attachBarcode(client, item.item_id, raw, "unknown")
  return { itemCode: item.item_code, name: item.name }
}

export async function bindMissingCodeToItem(
  client: PoolClient,
  siteId: number,
  input: { code: string; itemCode: string }
): Promise<{ itemCode: string; name: string }> {
  const item = await resolveItemByCodeOrBarcode(client, siteId, input.itemCode.trim())
  if (!item) throw new WmsHttpError(404, `Номенклатура ${input.itemCode} не найдена`, "item_not_found")
  const raw = input.code.trim()
  const gtin = raw.replace(/\D/g, "").slice(0, 14)
  const barcode = gtin.length >= 8 ? gtin : raw
  if (barcode) await attachBarcode(client, item.item_id, barcode, gtin.length >= 8 ? "gtin" : "unknown")
  const alias = gtin.length >= 8 ? gtin : raw
  if (alias) {
    try {
      await client.query(
        `INSERT INTO wms_item_aliases (site_id, item_id, alias_sku, gtin, is_active, updated_at)
         VALUES ($1, $2::bigint, $3, $4, TRUE, now())`,
        [siteId, item.item_id, alias, gtin.length >= 8 ? gtin : null]
      )
    } catch {
      /* таблица алиасов может отличаться по колонкам — штрихкода достаточно */
    }
  }
  return { itemCode: item.item_code, name: item.name }
}

export type MissingNomenclatureAction = "bind" | "create" | "hold"

export async function resolveMissingNomenclature(
  client: PoolClient,
  siteId: number,
  codeListId: string,
  patch: {
    comment?: string | null
    action?: MissingNomenclatureAction
    itemCode?: string
    itemName?: string
  }
): Promise<{
  ok: true
  action?: MissingNomenclatureAction
  itemCode?: string
  itemName?: string
}> {
  const current = await client.query<{ entries_json: unknown }>(
    `SELECT entries_json FROM wms_code_lists
     WHERE site_id = $1 AND code_list_id = $2::bigint AND list_type = 'missing_nomenclature'`,
    [siteId, codeListId]
  )
  if (!current.rows[0]) throw new WmsHttpError(404, "Запись не найдена", "code_list_not_found")
  const entries = Array.isArray(current.rows[0].entries_json) ? current.rows[0].entries_json : []
  const first = ((entries[0] ?? {}) as Record<string, unknown>) || {}
  const code = String(first.code ?? "").trim()
  let resolved: { itemCode: string; name: string } | null = null
  if (patch.action === "create") {
    resolved = await createMissingItemCard(client, siteId, {
      code,
      name: patch.itemName,
      itemCode: patch.itemCode,
    })
  } else if (patch.action === "bind") {
    if (!patch.itemCode?.trim()) throw new WmsHttpError(400, "Укажите код номенклатуры", "item_code_required")
    resolved = await bindMissingCodeToItem(client, siteId, { code, itemCode: patch.itemCode })
  }
  const nextFirst = {
    ...first,
    comment: patch.comment === undefined ? first.comment : patch.comment?.trim() || null,
    resolvedAction: patch.action ?? first.resolvedAction ?? null,
    resolvedItemCode: resolved?.itemCode ?? first.resolvedItemCode ?? null,
    resolvedItemName: resolved?.name ?? first.resolvedItemName ?? null,
    resolvedAtIso: patch.action ? new Date().toISOString() : first.resolvedAtIso ?? null,
  }
  const next = [nextFirst, ...entries.slice(1)]
  await client.query(
    `UPDATE wms_code_lists SET entries_json = $3::jsonb
     WHERE site_id = $1 AND code_list_id = $2::bigint`,
    [siteId, codeListId, JSON.stringify(next)]
  )
  return {
    ok: true,
    action: patch.action,
    itemCode: resolved?.itemCode,
    itemName: resolved?.name,
  }
}

export async function actOnMissingCode(
  client: PoolClient,
  siteId: number,
  input: {
    code: string
    action: MissingNomenclatureAction
    itemCode?: string
    itemName?: string
    comment?: string | null
    deviceUid?: string
  }
): Promise<{ ok: true; action: MissingNomenclatureAction; itemCode?: string; itemName?: string }> {
  const code = input.code.trim()
  if (!code) throw new WmsHttpError(400, "Нет кода", "missing_code")
  if (input.action === "create") {
    const created = await createMissingItemCard(client, siteId, {
      code,
      name: input.itemName,
      itemCode: input.itemCode,
    })
    return { ok: true, action: "create", itemCode: created.itemCode, itemName: created.name }
  }
  if (input.action === "bind") {
    if (!input.itemCode?.trim()) throw new WmsHttpError(400, "Укажите код номенклатуры", "item_code_required")
    const bound = await bindMissingCodeToItem(client, siteId, { code, itemCode: input.itemCode })
    return { ok: true, action: "bind", itemCode: bound.itemCode, itemName: bound.name }
  }
  await createCodeList(client, siteId, {
    requestId: randomUUID(),
    deviceUid: input.deviceUid?.trim() || "web-operator",
    listType: "missing_nomenclature",
    entries: [
      {
        kind: "code",
        code,
        note: "Отсутствует номенклатура, нужно добавить позже",
        comment: input.comment ?? "hold",
      },
    ],
  })
  return { ok: true, action: "hold" }
}
