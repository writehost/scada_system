import type { PoolClient } from "pg";
import { canonicalWarehouseCode } from "./warehouse-codes";
import { canonicalSiteCode, PRIMARY_SITE_CODE } from "@/lib/wms/site-code";

function extractGtinCandidates(value: string): string[] {
  const raw = value.trim().replace(/^["']|["']$/g, "");
  const compact = raw.replace(/\s/g, "");
  const candidates = new Set<string>();

  if (/^\d{13,14}$/.test(compact)) {
    candidates.add(compact.padStart(14, "0").slice(-14));
  }

  const ai01 = compact.match(/(?:^|\(01\)|01)(\d{14})/);
  if (ai01?.[1]) candidates.add(ai01[1]);

  const parenAi01 = raw.match(/\(01\)(\d{14})/);
  if (parenAi01?.[1]) candidates.add(parenAi01[1]);

  return [...candidates];
}

/**
 * Площадки не меняются в течение работы процесса, а запрос к базе идёт через
 * туннель (~130 мс) и выполняется в каждом обработчике API. Кэшируем найденный
 * id; отсутствие площадки не кэшируем, чтобы новая появилась сразу.
 */
const SITE_ID_TTL_MS = 10 * 60 * 1000;
const siteIdCache = new Map<string, { siteId: number; at: number }>();

export function invalidateSiteIdCache(siteCode?: string): void {
  if (siteCode) siteIdCache.delete(siteCode.trim());
  else siteIdCache.clear();
}

export async function getSiteId(
  client: PoolClient,
  siteCode: string
): Promise<number | null> {
  const requested = siteCode.trim();
  const key = canonicalSiteCode(requested);
  const cached = siteIdCache.get(key) || (requested ? siteIdCache.get(requested) : undefined);
  if (cached && Date.now() - cached.at < SITE_ID_TTL_MS) return cached.siteId;

  const candidates = [...new Set([key, requested, PRIMARY_SITE_CODE, "DEFAULT"].filter(Boolean))];
  const r = await client.query<{ site_id: number; site_code: string }>(
    `SELECT site_id, site_code FROM wms_sites
     WHERE is_active AND site_code = ANY($1::text[])
     ORDER BY CASE
       WHEN site_code = $2 THEN 0
       WHEN site_code = $3 THEN 1
       ELSE 2
     END
     LIMIT 1`,
    [candidates, key, requested]
  );
  const siteId = r.rows[0]?.site_id ?? null;
  if (siteId != null) {
    const at = Date.now();
    siteIdCache.set(key, { siteId, at });
    if (requested) siteIdCache.set(requested, { siteId, at });
  }
  return siteId;
}

export async function resolveItemByCodeOrBarcode(
  client: PoolClient,
  siteId: number,
  itemCodeOrBarcode: string
): Promise<{
  item_id: string;
  item_code: string;
  name: string;
} | null> {
  const q = itemCodeOrBarcode.trim();
  const gtinCandidates = extractGtinCandidates(q);
  const r = await client.query<{
    item_id: string;
    item_code: string;
    name: string;
  }>(
    `SELECT i.item_id::text AS item_id, i.item_code, i.name
     FROM wms_items i
     LEFT JOIN wms_item_barcodes b ON b.item_id = i.item_id
     LEFT JOIN wms_item_aliases a ON a.item_id = i.item_id AND a.site_id = i.site_id AND a.is_active
     WHERE i.site_id = $1
       AND (
         i.item_code = $2
         OR b.barcode = $2
         OR a.alias_sku = $2
         OR lower(a.alias_name) = lower($2)
         OR (
           cardinality($3::text[]) > 0
           AND (
             i.item_code = ANY($3::text[])
             OR b.barcode = ANY($3::text[])
             OR COALESCE(i.nomenclature, '') = ANY($3::text[])
             OR COALESCE(i.nomenclature, '') = ANY(ARRAY(SELECT '(01)' || x FROM unnest($3::text[]) AS x))
             OR COALESCE(i.item_attrs_json->'nomenclature'->>'gtin', i.item_attrs_json->>'gtin', '') = ANY($3::text[])
           )
         )
       )
     ORDER BY
       CASE
         WHEN i.item_code = $2 THEN 0
         WHEN b.barcode = $2 THEN 1
         WHEN a.alias_sku = $2 THEN 2
         WHEN cardinality($3::text[]) > 0 AND b.barcode = ANY($3::text[]) THEN 3
         WHEN cardinality($3::text[]) > 0 AND i.item_code = ANY($3::text[]) THEN 4
         ELSE 5
       END
     LIMIT 1`,
    [siteId, q, gtinCandidates]
  );
  return r.rows[0] ?? null;
}

export async function resolveLocation(
  client: PoolClient,
  siteId: number,
  locationCode: string
): Promise<{
  location_id: string;
  location_code: string;
  location_status_id: number;
} | null> {
  const r = await client.query<{
    location_id: string;
    location_code: string;
    location_status_id: number;
  }>(
    `SELECT location_id::text AS location_id, location_code, location_status_id
     FROM wms_locations
     WHERE site_id = $1 AND lower(btrim(location_code)) = lower(btrim($2::text))`,
    [siteId, locationCode.trim()]
  );
  return r.rows[0] ?? null;
}

export async function resolveWarehouse(
  client: PoolClient,
  siteId: number,
  warehouseCode: string
): Promise<{
  warehouse_id: string;
  warehouse_code: string;
} | null> {
  const canonical = canonicalWarehouseCode(warehouseCode);
  const r = await client.query<{
    warehouse_id: string;
    warehouse_code: string;
  }>(
    `SELECT warehouse_id::text AS warehouse_id, warehouse_code
     FROM wms_warehouses
     WHERE site_id = $1 AND warehouse_code = $2 AND is_active`,
    [siteId, canonical]
  );
  return r.rows[0] ?? null;
}

export async function resolveTaskById(
  client: PoolClient,
  siteId: number,
  taskId: string
): Promise<{
  task_id: string;
  task_type_id: number;
  task_status_id: number;
  document_id: string | null;
  document_line_id: string | null;
  item_id: string | null;
  lot_id: string | null;
  source_location_id: string | null;
  target_location_id: string | null;
  source_warehouse_id: string | null;
  target_warehouse_id: string | null;
  assigned_device_id: string | null;
  planned_qty: string;
  confirmed_qty: string;
  task_payload: unknown;
} | null> {
  const r = await client.query<{
    task_id: string;
    task_type_id: number;
    task_status_id: number;
    document_id: string | null;
    document_line_id: string | null;
    item_id: string | null;
    lot_id: string | null;
    source_location_id: string | null;
    target_location_id: string | null;
    source_warehouse_id: string | null;
    target_warehouse_id: string | null;
    assigned_device_id: string | null;
    planned_qty: string;
    confirmed_qty: string;
    task_payload: unknown;
  }>(
    `SELECT
       task_id::text AS task_id,
       task_type_id,
       task_status_id,
       document_id::text AS document_id,
       document_line_id::text AS document_line_id,
       item_id::text AS item_id,
       lot_id::text AS lot_id,
       source_location_id::text AS source_location_id,
       target_location_id::text AS target_location_id,
       source_warehouse_id::text AS source_warehouse_id,
       target_warehouse_id::text AS target_warehouse_id,
       assigned_device_id::text AS assigned_device_id,
       planned_qty::text,
       confirmed_qty::text,
       task_payload
     FROM wms_tasks
     WHERE site_id = $1 AND task_id = $2::bigint`,
    [siteId, taskId]
  );
  return r.rows[0] ?? null;
}
