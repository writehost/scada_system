import type { PoolClient } from "pg";
import { normalizeCrptCode } from "@/lib/wms/crpt";
import { ensureWmsLot } from "@/lib/wms/documents";
import { WmsHttpError } from "@/lib/wms/errors";
import { resolveOrCreateFgPlanLocation } from "@/lib/wms/fg-plan-locations";
import { resolveItemByCodeOrBarcode, resolveLocation } from "@/lib/wms/resolve";
import { applyStockReceipt } from "@/lib/wms/stock-ledger";

export type FgReceiptLineInput = {
  itemCode: string;
  locationCode: string;
  qty: number;
  lotCode?: string;
  manufacturedAt?: string;
  expiryAt?: string;
  bestBeforeAt?: string;
  markingCodes?: string[];
};

export type FgReceiptApplyInput = {
  siteId: number;
  sourceSystem?: string;
  externalId?: string;
  lines: FgReceiptLineInput[];
  actorUserId?: string | null;
};

export type FgReceiptLineResult = {
  itemCode: string;
  itemName: string;
  locationCode: string;
  qty: number;
  balanceId: string;
  lotId: string | null;
  linkedMarkingCodes: number;
  unknownMarkingCodes: string[];
};

function parseGs1Unit(raw: string): { gtin: string; serial: string } | null {
  const normalized = normalizeCrptCode(raw);
  const m = normalized.match(/^01(\d{14})21([\s\S]+)$/);
  if (!m) return null;
  const serial = m[2].split("\x1d")[0]?.trim();
  if (!serial) return null;
  return { gtin: m[1], serial };
}

async function resolveCodeId(client: PoolClient, raw: string): Promise<string | null> {
  const parsed = parseGs1Unit(raw);
  if (!parsed) return null;
  const r = await client.query<{ code_id: string }>(
    `SELECT code_id::text
     FROM codes
     WHERE ai01_gtin = $1::char(14) AND ai21_serial = $2
     LIMIT 1`,
    [parsed.gtin, parsed.serial]
  );
  return r.rows[0]?.code_id ?? null;
}

async function assertFinishedGoodsItem(
  client: PoolClient,
  siteId: number,
  itemId: string,
  itemCode: string
) {
  const r = await client.query<{ item_type_code: string | null }>(
    `SELECT item_type_code FROM wms_items WHERE site_id = $1 AND item_id = $2::bigint`,
    [siteId, itemId]
  );
  if (r.rows[0]?.item_type_code !== "finished_goods") {
    throw new WmsHttpError(
      409,
      `Номенклатура ${itemCode} не относится к готовой продукции (item_type_code=finished_goods)`,
      "not_finished_goods"
    );
  }
}

async function linkMarkingCode(
  client: PoolClient,
  input: {
    siteId: number;
    itemId: string;
    locationId: string;
    codeId: string;
    note: string;
  }
) {
  await client.query(
    `INSERT INTO wms_item_codes (item_id, code_id, current_site_id, current_location_id, note, linked_at)
     VALUES ($1::bigint, $2::bigint, $3, $4::bigint, $5, now())
     ON CONFLICT (code_id) DO UPDATE SET
       item_id = EXCLUDED.item_id,
       current_site_id = EXCLUDED.current_site_id,
       current_location_id = EXCLUDED.current_location_id,
       unlinked_at = NULL,
       note = EXCLUDED.note,
       linked_at = now()`,
    [input.itemId, input.codeId, input.siteId, input.locationId, input.note]
  );

  const legacy = await client.query<{ location_id: number | null }>(
    `SELECT legacy_location_id AS location_id FROM wms_locations WHERE location_id = $1::bigint`,
    [input.locationId]
  );
  const legacyLocId = legacy.rows[0]?.location_id;
  if (legacyLocId != null) {
    await client.query(
      `UPDATE code_state cs
       SET location_id = $1, updated_at = now()
       WHERE cs.code_id = $2::bigint AND cs.site_id = $3`,
      [legacyLocId, input.codeId, input.siteId]
    );
  }
}

export async function applyFgWarehouseReceipt(
  client: PoolClient,
  input: FgReceiptApplyInput
): Promise<{ lines: FgReceiptLineResult[] }> {
  if (!input.lines.length) {
    throw new WmsHttpError(400, "lines is required", "lines_required");
  }

  const results: FgReceiptLineResult[] = [];
  const noteBase = [
    input.sourceSystem ? `source=${input.sourceSystem}` : null,
    input.externalId ? `externalId=${input.externalId}` : null,
  ]
    .filter(Boolean)
    .join("; ");

  for (const line of input.lines) {
    const itemCode = line.itemCode.trim();
    const locationCode = line.locationCode.trim();
    const qty = Number(line.qty);
    if (!itemCode || !locationCode) {
      throw new WmsHttpError(400, "itemCode and locationCode are required", "line_invalid");
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new WmsHttpError(400, "qty must be positive", "bad_qty");
    }

    const item = await resolveItemByCodeOrBarcode(client, input.siteId, itemCode);
    if (!item) {
      throw new WmsHttpError(404, `item not found: ${itemCode}`, "item_not_found");
    }
    await assertFinishedGoodsItem(client, input.siteId, item.item_id, item.item_code);

    const fgLoc = await resolveOrCreateFgPlanLocation(client, input.siteId, locationCode);
    const loc = await resolveLocation(client, input.siteId, fgLoc.locationCode);
    if (!loc) {
      throw new WmsHttpError(404, `location not found: ${locationCode}`, "location_not_found");
    }
    if (loc.location_status_id === 2) {
      throw new WmsHttpError(409, `location is blocked: ${locationCode}`, "location_blocked");
    }

    const lotCode = line.lotCode?.trim() || null;
    let lotId: string | null = null;
    if (lotCode) {
      lotId = await ensureWmsLot(
        client,
        input.siteId,
        item.item_id,
        lotCode,
        lotCode,
        line.manufacturedAt,
        line.bestBeforeAt,
        line.expiryAt
      );
    }

    const receipt = await applyStockReceipt(client, {
      siteId: input.siteId,
      itemId: item.item_id,
      toLocationId: loc.location_id,
      qty,
      lotId,
      lotCode,
      lotExpiryAt: line.expiryAt ?? line.bestBeforeAt ?? null,
      actorUserId: input.actorUserId ?? null,
      payload: {
        sourceSystem: input.sourceSystem ?? null,
        externalId: input.externalId ?? null,
        fgReceipt: true,
      },
    });

    const markingCodes = [...new Set((line.markingCodes ?? []).map((c) => c.trim()).filter(Boolean))];
    const unknownMarkingCodes: string[] = [];
    let linkedMarkingCodes = 0;
    for (const raw of markingCodes) {
      const codeId = await resolveCodeId(client, raw);
      if (!codeId) {
        unknownMarkingCodes.push(raw.slice(0, 80));
        continue;
      }
      await linkMarkingCode(client, {
        siteId: input.siteId,
        itemId: item.item_id,
        locationId: loc.location_id,
        codeId,
        note: noteBase ? `fg_receipt; ${noteBase}` : "fg_receipt",
      });
      linkedMarkingCodes += 1;
    }

    results.push({
      itemCode: item.item_code,
      itemName: item.name,
      locationCode: loc.location_code,
      qty,
      balanceId: receipt.balanceId,
      lotId,
      linkedMarkingCodes,
      unknownMarkingCodes,
    });
  }

  return { lines: results };
}
