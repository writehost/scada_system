import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { workshopLocationWhere } from "@/lib/wms/workshop-directory";

export type WorkshopCodeRow = {
  codeId: string;
  itemCode: string;
  itemName: string;
  gtin: string;
  serial: string;
  locationCode: string;
  locationName: string;
  warehouseCode: string;
  zoneCode: string;
  statusId: number;
  statusName: string;
  linkedAt: string | null;
};

export async function listWorkshopCodes(
  client: PoolClient,
  siteId: number,
  filters: {
    locationCode?: string;
    warehouseCode?: string;
    itemCode?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ rows: WorkshopCodeRow[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 2000);
  const offset = Math.max(filters.offset ?? 0, 0);
  const wh = filters.warehouseCode?.trim() || null;
  const loc = filters.locationCode?.trim() || null;
  const item = filters.itemCode?.trim() || null;

  const baseFrom = `
    FROM wms_item_codes wc
    JOIN codes c ON c.code_id = wc.code_id
    JOIN code_state cs ON cs.code_id = c.code_id AND cs.site_id = wc.current_site_id
    JOIN ref_status rs ON rs.status_id = cs.status_id
    JOIN wms_items i ON i.item_id = wc.item_id AND i.site_id = wc.current_site_id
    JOIN wms_locations l ON l.location_id = wc.current_location_id AND l.site_id = wc.current_site_id
    JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
    JOIN wms_zones z ON z.zone_id = l.zone_id
    WHERE wc.current_site_id = $1
      AND wc.unlinked_at IS NULL
      AND wc.current_location_id IS NOT NULL
      AND ${workshopLocationWhere("w", "z")}
      AND ($2::text IS NULL OR w.warehouse_code = $2)
      AND ($3::text IS NULL OR l.location_code = $3)
      AND ($4::text IS NULL OR i.item_code = $4)`;

  const countR = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total ${baseFrom}`,
    [siteId, wh, loc, item]
  );
  const total = Number(countR.rows[0]?.total ?? "0");

  const rowsR = await client.query<{
    codeId: string;
    itemCode: string;
    itemName: string;
    gtin: string;
    serial: string;
    locationCode: string;
    locationName: string;
    warehouseCode: string;
    zoneCode: string;
    statusId: number;
    statusName: string;
    linkedAt: string | null;
  }>(
    `SELECT
       c.code_id::text AS "codeId",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       c.ai01_gtin AS gtin,
       c.ai21_serial AS serial,
       l.location_code AS "locationCode",
       l.display_name AS "locationName",
       w.warehouse_code AS "warehouseCode",
       z.zone_code AS "zoneCode",
       cs.status_id AS "statusId",
       rs.name AS "statusName",
       wc.linked_at::text AS "linkedAt"
     ${baseFrom}
     ORDER BY l.location_code, i.item_code, c.code_id
     LIMIT $5 OFFSET $6`,
    [siteId, wh, loc, item, limit, offset]
  );

  return { rows: rowsR.rows, total };
}

export async function countWorkshopCodesByLocation(
  client: PoolClient,
  siteId: number,
  locationCodes: string[]
): Promise<Map<string, number>> {
  const codes = [...new Set(locationCodes.map((c) => c.trim()).filter(Boolean))];
  const out = new Map<string, number>();
  if (codes.length === 0) return out;

  const r = await client.query<{ locationCode: string; cnt: string }>(
    `SELECT l.location_code AS "locationCode", COUNT(*)::text AS cnt
     FROM wms_item_codes wc
     JOIN wms_locations l ON l.location_id = wc.current_location_id AND l.site_id = wc.current_site_id
     WHERE wc.current_site_id = $1
       AND wc.unlinked_at IS NULL
       AND l.location_code = ANY($2::text[])
     GROUP BY l.location_code`,
    [siteId, codes]
  );
  for (const row of r.rows) out.set(row.locationCode, Number(row.cnt));
  return out;
}

export type TransferCodesResult = {
  movedCount: number;
  codeIds: string[];
};

export async function transferItemCodesToWorkshop(
  client: PoolClient,
  input: {
    siteId: number;
    itemId: string;
    sourceLocationId: string;
    targetLocationId: string;
    qty: number;
    documentId: string;
    codeValues?: string[];
  }
): Promise<TransferCodesResult> {
  const qty = Math.max(0, Math.trunc(input.qty));
  if (qty === 0) return { movedCount: 0, codeIds: [] };

  let codeIds: string[] = [];

  if (input.codeValues && input.codeValues.length > 0) {
    const values = input.codeValues.map((v) => v.trim()).filter(Boolean).slice(0, qty);
    if (values.length === 0) return { movedCount: 0, codeIds: [] };

    const found = await client.query<{ code_id: string }>(
      `SELECT DISTINCT c.code_id::text
       FROM codes c
       JOIN wms_item_codes wc ON wc.code_id = c.code_id
       WHERE wc.current_site_id = $1
         AND wc.item_id = $2::bigint
         AND wc.unlinked_at IS NULL
         AND (
           c.ai21_serial = ANY($3::text[])
           OR encode(c.raw, 'escape') = ANY($3::text[])
         )
       LIMIT $4`,
      [input.siteId, input.itemId, values, qty]
    );
    codeIds = found.rows.map((r) => r.code_id);
    if (codeIds.length === 0) {
      return { movedCount: 0, codeIds: [] };
    }
  } else {
    const picked = await client.query<{ code_id: string }>(
      `SELECT wc.code_id::text
       FROM wms_item_codes wc
       WHERE wc.current_site_id = $1
         AND wc.item_id = $2::bigint
         AND wc.unlinked_at IS NULL
         AND (
           wc.current_location_id = $3::bigint
           OR wc.current_location_id IS NULL
         )
       ORDER BY
         CASE WHEN wc.current_location_id = $3::bigint THEN 0 ELSE 1 END,
         wc.linked_at NULLS LAST,
         wc.code_id
       LIMIT $4
       FOR UPDATE OF wc`,
      [input.siteId, input.itemId, input.sourceLocationId, qty]
    );
    codeIds = picked.rows.map((r) => r.code_id);
  }

  if (codeIds.length === 0) return { movedCount: 0, codeIds: [] };

  const upd = await client.query<{ code_id: string }>(
    `UPDATE wms_item_codes wc
     SET current_location_id = $1::bigint,
         last_document_id = $2::bigint,
         note = COALESCE(note, '') || CASE WHEN COALESCE(note, '') = '' THEN '' ELSE E'\\n' END || $5
     WHERE wc.current_site_id = $3
       AND wc.code_id = ANY($4::bigint[])
     RETURNING wc.code_id::text`,
    [
      input.targetLocationId,
      input.documentId,
      input.siteId,
      codeIds,
      `Выдано в цех (док. ${input.documentId})`,
    ]
  );

  const legacy = await client.query<{ location_id: number | null }>(
    `SELECT legacy_location_id AS location_id FROM wms_locations WHERE location_id = $1::bigint`,
    [input.targetLocationId]
  );
  const legacyLocId = legacy.rows[0]?.location_id;
  if (legacyLocId != null) {
    await client.query(
      `UPDATE code_state cs
       SET location_id = $1,
           updated_at = now()
       FROM unnest($2::bigint[]) AS cid(code_id)
       WHERE cs.code_id = cid.code_id AND cs.site_id = $3`,
      [legacyLocId, upd.rows.map((r) => r.code_id), input.siteId]
    );
  }

  return { movedCount: upd.rows.length, codeIds: upd.rows.map((r) => r.code_id) };
}

export async function assertWorkshopTargetLocation(
  client: PoolClient,
  siteId: number,
  locationId: string
): Promise<void> {
  const r = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM wms_locations l
       JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
       JOIN wms_zones z ON z.zone_id = l.zone_id
       WHERE l.site_id = $1 AND l.location_id = $2::bigint
         AND ${workshopLocationWhere("w", "z")}
     ) AS ok`,
    [siteId, locationId]
  );
  if (!r.rows[0]?.ok) {
    throw new WmsHttpError(
      400,
      "Ячейка назначения не относится к цеху. Создайте цех в настройках и ячейку в производственной зоне.",
      "target_not_workshop"
    );
  }
}
