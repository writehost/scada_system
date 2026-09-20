import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { normalizeCrptCode } from "@/lib/wms/crpt";
import { getUpstreamCrptBearerToken } from "@/lib/wms/crpt-auth";
import { ensureWmsLot } from "@/lib/wms/documents";
import { WmsHttpError } from "@/lib/wms/errors";
import { buildReceivingLotCode, emissionDayKey } from "@/lib/wms/issue-stock";
import { fetchBalanceSnapshot } from "@/lib/wms/query";
import {
  computeCodeExpiry,
  fetchCrptCisInfo,
  mapCrptStatusToCodeStateId,
  pickEmissionDateValue,
  pickExpirationDateValue,
  resolveReceivingShelfLifeDays,
} from "@/lib/wms/receiving-crpt";
import { WMS_DOCUMENT_STATUS, WMS_DOCUMENT_TYPE } from "@/lib/wms/ref";
import { resolveItemByCodeOrBarcode, resolveLocation } from "@/lib/wms/resolve";
import { applyWorkshopDirectReceipt } from "@/lib/wms/stock-ledger";
import { assertWorkshopTargetLocation } from "@/lib/wms/workshop-codes";
import { assertWaitingCellAcceptsItemByLocationId } from "@/lib/wms/workshop-waiting-cell";

function bigintHash(value: string): string {
  const buf = crypto.createHash("sha256").update(value, "utf8").digest();
  return buf.readBigInt64BE(0).toString();
}

function parseGs1Unit(raw: string): { gtin: string; serial: string; normalized: string } | null {
  const normalized = normalizeCrptCode(raw);
  const m = normalized.match(/^01(\d{14})21([\s\S]+)$/);
  if (!m) return null;
  const serial = m[2].split("\x1d")[0]?.trim();
  if (!serial) return null;
  return { gtin: m[1], serial, normalized };
}

async function resolveItemByGtin(
  client: PoolClient,
  siteId: number,
  gtin: string
): Promise<{ item_id: string; item_code: string; name: string; shelf_life_days: number | null } | null> {
  // Ищем по штрихкодам / коду / SKU. Таблица wms_product_gtins на части стендов
  // ещё не заведена — не зависаем на relation "wms_product_gtins" does not exist.
  const r = await client.query<{
    item_id: string;
    item_code: string;
    name: string;
    shelf_life_days: number | null;
  }>(
    `SELECT i.item_id::text, i.item_code, i.name, i.shelf_life_days
     FROM wms_items i
     LEFT JOIN wms_item_barcodes b ON b.item_id = i.item_id
     WHERE i.site_id = $1
       AND (
         b.barcode = $2
         OR b.barcode = ltrim($2, '0')
         OR i.item_code = $2
         OR i.sku = $2
         OR COALESCE(i.item_attrs_json->>'internalGtin', '') = $2
         OR COALESCE(i.item_attrs_json->>'internalGtin', '') = ltrim($2, '0')
       )
     ORDER BY i.is_active DESC, i.item_id
     LIMIT 1`,
    [siteId, gtin]
  );
  return r.rows[0] ?? null;
}

async function ensureMarkingCodeLinked(
  client: PoolClient,
  siteId: number,
  itemId: string,
  parsed: { gtin: string; serial: string; normalized: string },
  opts?: { statusId?: number; emittedAtIso?: string | null }
): Promise<string> {
  const existing = await client.query<{ code_id: string }>(
    `SELECT code_id::text
     FROM codes
     WHERE ai01_gtin = $1 AND ai21_serial = $2
     LIMIT 1`,
    [parsed.gtin, parsed.serial]
  );
  let codeId = existing.rows[0]?.code_id ?? null;

  if (!codeId) {
    const rawHash = bigintHash(parsed.normalized);
    const baseHash = bigintHash(`01${parsed.gtin}21${parsed.serial}`);
    const product = await client.query<{ product_id: number }>(
      `INSERT INTO marking_products (gtin)
       VALUES ($1)
       ON CONFLICT (gtin) DO UPDATE SET gtin = EXCLUDED.gtin
       RETURNING product_id`,
      [parsed.gtin]
    );
    const inserted = await client.query<{ code_id: string }>(
      `INSERT INTO codes (ai01_gtin, ai21_serial, raw, raw_hash, product_id, base_hash, flags)
       VALUES ($1, $2, $3, $4::bigint, $5, $6::bigint, 0)
       ON CONFLICT (raw_hash) DO UPDATE SET raw = EXCLUDED.raw
       RETURNING code_id::text`,
      [
        parsed.gtin,
        parsed.serial,
        Buffer.from(parsed.normalized, "utf8"),
        rawHash,
        product.rows[0]!.product_id,
        baseHash,
      ]
    );
    codeId = inserted.rows[0]!.code_id;
  }

  const statusId = opts?.statusId ?? 5; // introduced / в обороте — не "printed"
  const emittedAt = opts?.emittedAtIso ? new Date(opts.emittedAtIso) : new Date();

  await client.query(
    `INSERT INTO code_state (code_id, site_id, status_id, feature_flags, emitted_at, updated_at)
     VALUES ($1::bigint, $2, $3, 0, $4, now())
     ON CONFLICT (code_id) DO UPDATE SET
       site_id = EXCLUDED.site_id,
       status_id = GREATEST(code_state.status_id, EXCLUDED.status_id),
       emitted_at = COALESCE(EXCLUDED.emitted_at, code_state.emitted_at),
       updated_at = now()`,
    [codeId, siteId, statusId, emittedAt]
  );

  await client.query(
    `INSERT INTO wms_item_codes (item_id, code_id, current_site_id, note)
     VALUES ($1::bigint, $2::bigint, $3, $4)
     ON CONFLICT (code_id) DO UPDATE SET
       item_id = EXCLUDED.item_id,
       current_site_id = EXCLUDED.current_site_id,
       unlinked_at = NULL,
       note = COALESCE(wms_item_codes.note, '') || CASE WHEN COALESCE(wms_item_codes.note, '') = '' THEN '' ELSE E'\\n' END || EXCLUDED.note`,
    [itemId, codeId, siteId, "workshop_direct_receipt"]
  );

  return codeId;
}

export type WorkshopDirectReceiptInput = {
  requestId: string;
  itemCode?: string | null;
  targetLocationCode: string;
  datamatrix: string;
  qty: number;
  operatorName?: string | null;
  manufacturedAt?: string | null;
  expiryAt?: string | null;
  lotCode?: string | null;
};

export async function receiveStickerToWorkshopCell(
  client: PoolClient,
  siteId: number,
  input: WorkshopDirectReceiptInput
) {
  const parsed = parseGs1Unit(input.datamatrix);
  if (!parsed) {
    throw new WmsHttpError(400, "Не удалось разобрать DataMatrix стикера", "bad_datamatrix");
  }

  let item =
    input.itemCode?.trim()
      ? await resolveItemByCodeOrBarcode(client, siteId, input.itemCode.trim()).then(async (found) => {
          if (!found) return null;
          const extra = await client.query<{ shelf_life_days: number | null }>(
            `SELECT shelf_life_days FROM wms_items WHERE item_id = $1::bigint`,
            [found.item_id]
          );
          return {
            ...found,
            shelf_life_days: extra.rows[0]?.shelf_life_days ?? null,
          };
        })
      : null;
  if (!item) {
    item = await resolveItemByGtin(client, siteId, parsed.gtin);
  }
  if (!item) {
    throw new WmsHttpError(
      404,
      "Номенклатура не найдена по GTIN — заведите товар в WMS",
      "item_not_found"
    );
  }

  const loc = await resolveLocation(client, siteId, input.targetLocationCode.trim());
  if (!loc) throw new WmsHttpError(404, "Ячейка не найдена", "location_not_found");
  if (loc.location_status_id === 2) {
    throw new WmsHttpError(409, "Ячейка заблокирована", "location_blocked");
  }

  await assertWorkshopTargetLocation(client, siteId, loc.location_id);
  await assertWaitingCellAcceptsItemByLocationId(
    client,
    siteId,
    loc.location_id,
    item.item_id,
    item.item_code
  );

  // Тянем даты/статус из ЧЗ — раньше писали printed + now(), отсюда «годен до завтра+365».
  let crptStatus: string | null = null;
  let crptManufacturedAt: string | null = null;
  let crptExpiryAt: string | null = null;
  try {
    const token = getUpstreamCrptBearerToken();
    const cis = await fetchCrptCisInfo(parsed.normalized, token);
    crptStatus = typeof cis.status === "string" ? cis.status.trim() : null;
    const shelfLife = resolveReceivingShelfLifeDays(item.shelf_life_days, cis);
    const expiry = computeCodeExpiry(
      pickEmissionDateValue(cis),
      shelfLife,
      0,
      pickExpirationDateValue(cis)
    );
    crptManufacturedAt = expiry.emissionAt;
    crptExpiryAt = expiry.expiresAt;
    if (expiry.state === "expired") {
      throw new WmsHttpError(409, expiry.message, "code_expired", {
        emissionAt: expiry.emissionAt,
        expiresAt: expiry.expiresAt,
        daysRemaining: expiry.daysRemaining,
        shelfLifeDays: expiry.shelfLifeDays,
      });
    }
  } catch (e) {
    if (e instanceof WmsHttpError) throw e;
    // Если ЧЗ недоступен — продолжаем без его дат, но не ставим фейковый "printed".
  }

  const codeId = await ensureMarkingCodeLinked(client, siteId, item.item_id, parsed, {
    statusId: mapCrptStatusToCodeStateId(crptStatus),
    emittedAtIso: crptManufacturedAt,
  });

  const codeLoc = await client.query<{ location_code: string | null; location_id: string | null }>(
    `SELECT l.location_code, wc.current_location_id::text AS location_id
     FROM wms_item_codes wc
     LEFT JOIN wms_locations l ON l.location_id = wc.current_location_id
     WHERE wc.current_site_id = $1 AND wc.code_id = $2::bigint AND wc.unlinked_at IS NULL`,
    [siteId, codeId]
  );
  const currentLocId = codeLoc.rows[0]?.location_id ?? null;
  const currentLocCode = codeLoc.rows[0]?.location_code ?? null;
  if (currentLocId && currentLocId === loc.location_id) {
    const stock = await fetchBalanceSnapshot(client, siteId, loc.location_id, item.item_id);
    return {
      documentId: null,
      idempotent: true,
      itemCode: item.item_code,
      itemName: item.name,
      targetLocationCode: loc.location_code,
      lotCode: null,
      expiryAt: input.expiryAt ?? crptExpiryAt ?? null,
      codeId,
      stock,
    };
  }
  if (currentLocId && currentLocId !== loc.location_id) {
    throw new WmsHttpError(
      409,
      `Стикер уже в ячейке ${currentLocCode ?? currentLocId}`,
      "code_location_mismatch",
      { currentLocationCode: currentLocCode }
    );
  }

  const qty = Math.max(1, Math.trunc(input.qty));
  const manufacturedAt = input.manufacturedAt?.trim() || crptManufacturedAt || null;
  let expiryAt = input.expiryAt?.trim() || crptExpiryAt || null;
  // Если ЧЗ/клиент не дали срок, а эмиссия есть — считаем от shelf_life номенклатуры (обычно 365).
  if (!expiryAt && manufacturedAt && item.shelf_life_days != null && item.shelf_life_days > 0) {
    const fromShelf = computeCodeExpiry(manufacturedAt, Number(item.shelf_life_days), 0);
    expiryAt = fromShelf.expiresAt;
    if (fromShelf.state === "expired") {
      throw new WmsHttpError(409, fromShelf.message, "code_expired", {
        emissionAt: fromShelf.emissionAt,
        expiresAt: fromShelf.expiresAt,
        daysRemaining: fromShelf.daysRemaining,
        shelfLifeDays: fromShelf.shelfLifeDays,
      });
    }
  }
  const emissionDay = manufacturedAt ? emissionDayKey(manufacturedAt) : emissionDayKey(new Date().toISOString());
  const lotCode =
    input.lotCode?.trim() ||
    buildReceivingLotCode(item.item_code, emissionDay !== "unknown" ? emissionDay : "LOCAL");

  const lotId = await ensureWmsLot(
    client,
    siteId,
    item.item_id,
    lotCode,
    `Приём маркировщика · ${lotCode}`,
    manufacturedAt ?? undefined,
    expiryAt ?? undefined,
    expiryAt ?? undefined
  );

  const doc = await client.query<{ document_id: string }>(
    `INSERT INTO wms_documents (
       site_id, document_type_id, document_status_id, request_id,
       target_location_id, operator_name, line_name, comment, payload_json, applied_at
     ) VALUES ($1, $2, $3, $4::uuid, $5::bigint, $6, $7, $8, $9::jsonb, now())
     RETURNING document_id::text`,
    [
      siteId,
      WMS_DOCUMENT_TYPE.receiving,
      WMS_DOCUMENT_STATUS.applied,
      input.requestId,
      loc.location_id,
      input.operatorName?.trim() || null,
      loc.location_code,
      "Прямой приём стикера в ячейку цеха",
      JSON.stringify({
        workshopDirectReceipt: true,
        datamatrix: parsed.normalized,
        gtin: parsed.gtin,
        serial: parsed.serial,
        codeId,
      }),
    ]
  );
  const documentId = doc.rows[0]!.document_id;

  const line = await client.query<{ document_line_id: string }>(
    `INSERT INTO wms_document_lines (
       document_id, line_no, item_id, target_location_id, requested_qty, confirmed_qty, lot_id, lot_code
     ) VALUES ($1::bigint, 1, $2::bigint, $3::bigint, $4, $4, $5::bigint, $6)
     RETURNING document_line_id::text`,
    [documentId, item.item_id, loc.location_id, qty, lotId, lotCode]
  );
  const documentLineId = line.rows[0]!.document_line_id;

  await applyWorkshopDirectReceipt(client, {
    siteId,
    itemId: item.item_id,
    toLocationId: loc.location_id,
    qty,
    lotId,
    lotCode,
    lotExpiryAt: expiryAt,
    documentId,
    documentLineId,
    requestId: input.requestId,
    operatorName: input.operatorName ?? null,
    payload: { workshopDirectReceipt: true, codeId },
  });

  await client.query(
    `UPDATE wms_item_codes
     SET current_location_id = $1::bigint,
         last_document_id = $2::bigint,
         linked_at = COALESCE(linked_at, now()),
         note = COALESCE(note, '') || CASE WHEN COALESCE(note, '') = '' THEN '' ELSE E'\\n' END || $4
     WHERE current_site_id = $3 AND code_id = $5::bigint`,
    [
      loc.location_id,
      documentId,
      siteId,
      `Принят в ${loc.location_code}`,
      codeId,
    ]
  );

  const legacy = await client.query<{ location_id: number | null }>(
    `SELECT legacy_location_id AS location_id FROM wms_locations WHERE location_id = $1::bigint`,
    [loc.location_id]
  );
  const legacyLocId = legacy.rows[0]?.location_id;
  if (legacyLocId != null) {
    await client.query(
      `UPDATE code_state cs
       SET location_id = $1, updated_at = now()
       WHERE cs.code_id = $2::bigint AND cs.site_id = $3`,
      [legacyLocId, codeId, siteId]
    );
  }

  const stock = await fetchBalanceSnapshot(client, siteId, loc.location_id, item.item_id);

  return {
    documentId,
    idempotent: false,
    itemCode: item.item_code,
    itemName: item.name,
    targetLocationCode: loc.location_code,
    lotCode,
    expiryAt,
    codeId,
    stock,
  };
}
