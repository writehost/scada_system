import type { PoolClient } from "pg";
import {
  mergeRackMeta,
  normalizeRackCode,
  rackCodeFromLabel,
  rackPrefixFromPhysicalAddress,
  type RackCellRow,
  type RackDirectoryRow,
  type RackMeta,
} from "@/lib/wms/rack-directory-meta";
import { parseSlotProfileFromAttrs } from "@/lib/wms/storage-slot";
import { compareSequentialCellCodes, sortSequentialCellCodes } from "@/lib/wms/workshop-waiting-cell";

export type { RackDirectoryRow, RackCellRow } from "@/lib/wms/rack-directory-meta";

function rowToDto(r: {
  rack_id: string;
  rack_code: string;
  name: string;
  address_label: string | null;
  warehouse_code: string | null;
  zone_code: string | null;
  meta_json: unknown;
  is_active: boolean;
  cell_count: string;
  created_at: string;
  updated_at: string;
  cells?: RackCellRow[];
}): RackDirectoryRow {
  return {
    rackId: r.rack_id,
    code: r.rack_code,
    name: r.name,
    addressLabel: r.address_label,
    warehouseCode: r.warehouse_code,
    zoneCode: r.zone_code,
    meta: (r.meta_json ?? {}) as RackMeta,
    isActive: r.is_active,
    cellCount: Number(r.cell_count) || 0,
    cells: r.cells ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const RACK_SELECT = `SELECT r.rack_id::text, r.rack_code, r.name, r.address_label,
  w.warehouse_code, z.zone_code,
  COALESCE(r.meta_json, '{}'::jsonb) AS meta_json,
  r.is_active, r.created_at::text, r.updated_at::text`;

async function loadRackCells(
  client: PoolClient,
  siteId: number,
  rackId: number
): Promise<RackCellRow[]> {
  const result = await client.query<{
    location_id: string;
    location_code: string;
    display_name: string;
    location_attrs_json: unknown;
    sort_order: number;
  }>(
    `SELECT l.location_id::text, l.location_code, l.display_name,
       l.location_attrs_json, rc.sort_order
     FROM wms_rack_cells rc
     JOIN wms_locations l ON l.location_id = rc.location_id AND l.site_id = rc.site_id
     WHERE rc.site_id = $1 AND rc.rack_id = $2
     ORDER BY rc.sort_order ASC, l.location_code ASC`,
    [siteId, rackId]
  );
  return result.rows
    .map((row) => {
      const profile = parseSlotProfileFromAttrs(row.location_attrs_json);
      return {
        locationId: row.location_id,
        locationCode: row.location_code,
        displayName: row.display_name,
        physicalAddress: profile?.physicalAddress ?? null,
        sortOrder: row.sort_order,
      };
    })
    .sort((a, b) => compareSequentialCellCodes(a.locationCode, b.locationCode));
}

export async function listRackDefs(
  client: PoolClient,
  siteId: number,
  opts?: { activeOnly?: boolean; includeCells?: boolean }
): Promise<RackDirectoryRow[]> {
  const activeOnly = opts?.activeOnly ?? false;
  const result = await client.query<{
    rack_id: string;
    rack_code: string;
    name: string;
    address_label: string | null;
    warehouse_code: string | null;
    zone_code: string | null;
    meta_json: unknown;
    is_active: boolean;
    cell_count: string;
    created_at: string;
    updated_at: string;
  }>(
    `${RACK_SELECT},
       (SELECT COUNT(*)::text FROM wms_rack_cells rc WHERE rc.rack_id = r.rack_id) AS cell_count
     FROM wms_rack_defs r
     LEFT JOIN wms_warehouses w ON w.warehouse_id = r.warehouse_id
     LEFT JOIN wms_zones z ON z.zone_id = r.zone_id
     WHERE r.site_id = $1
       AND ($2::boolean = false OR r.is_active = true)
     ORDER BY r.is_active DESC, r.rack_code ASC`,
    [siteId, activeOnly]
  );

  const rows = result.rows.map((r) => rowToDto(r));
  if (opts?.includeCells) {
    for (const row of rows) {
      row.cells = await loadRackCells(client, siteId, Number(row.rackId));
    }
  }
  return rows;
}

export async function getRackDef(
  client: PoolClient,
  siteId: number,
  rackCode: string
): Promise<RackDirectoryRow | null> {
  const result = await client.query<{
    rack_id: string;
    rack_code: string;
    name: string;
    address_label: string | null;
    warehouse_code: string | null;
    zone_code: string | null;
    meta_json: unknown;
    is_active: boolean;
    cell_count: string;
    created_at: string;
    updated_at: string;
  }>(
    `${RACK_SELECT},
       (SELECT COUNT(*)::text FROM wms_rack_cells rc WHERE rc.rack_id = r.rack_id) AS cell_count
     FROM wms_rack_defs r
     LEFT JOIN wms_warehouses w ON w.warehouse_id = r.warehouse_id
     LEFT JOIN wms_zones z ON z.zone_id = r.zone_id
     WHERE r.site_id = $1 AND upper(r.rack_code) = $2`,
    [siteId, rackCode.toUpperCase()]
  );
  if (!result.rows[0]) return null;
  const dto = rowToDto(result.rows[0]);
  dto.cells = await loadRackCells(client, siteId, Number(dto.rackId));
  return dto;
}

export async function getRackForLocation(
  client: PoolClient,
  siteId: number,
  locationCode: string
): Promise<RackDirectoryRow | null> {
  const result = await client.query<{ rack_code: string }>(
    `SELECT r.rack_code
     FROM wms_rack_cells rc
     JOIN wms_rack_defs r ON r.rack_id = rc.rack_id AND r.site_id = rc.site_id
     JOIN wms_locations l ON l.location_id = rc.location_id AND l.site_id = rc.site_id
     WHERE rc.site_id = $1 AND upper(l.location_code) = $2
     LIMIT 1`,
    [siteId, locationCode.toUpperCase()]
  );
  if (!result.rows[0]) return null;
  return getRackDef(client, siteId, result.rows[0].rack_code);
}

async function resolveWarehouseZone(
  client: PoolClient,
  siteId: number,
  warehouseCode?: string | null,
  zoneCode?: string | null
): Promise<{ warehouseId: number | null; zoneId: number | null }> {
  let warehouseId: number | null = null;
  let zoneId: number | null = null;
  if (warehouseCode?.trim()) {
    const w = await client.query<{ warehouse_id: string }>(
      `SELECT warehouse_id FROM wms_warehouses WHERE site_id = $1 AND upper(warehouse_code) = $2`,
      [siteId, warehouseCode.trim().toUpperCase()]
    );
    warehouseId = w.rows[0] ? Number(w.rows[0].warehouse_id) : null;
  }
  if (zoneCode?.trim()) {
    const z = await client.query<{ zone_id: string }>(
      `SELECT zone_id FROM wms_zones z
       JOIN wms_warehouses w ON w.warehouse_id = z.warehouse_id
       WHERE w.site_id = $1 AND upper(z.zone_code) = $2
         AND ($3::bigint IS NULL OR z.warehouse_id = $3)`,
      [siteId, zoneCode.trim().toUpperCase(), warehouseId]
    );
    zoneId = z.rows[0] ? Number(z.rows[0].zone_id) : null;
  }
  return { warehouseId, zoneId };
}

export async function createRackDef(
  client: PoolClient,
  siteId: number,
  input: {
    code?: string;
    name: string;
    addressLabel?: string | null;
    warehouseCode?: string | null;
    zoneCode?: string | null;
    meta?: RackMeta;
  }
) {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  const addressLabel = input.addressLabel?.trim().toUpperCase() || null;
  const code = input.code?.trim()
    ? normalizeRackCode(input.code)
    : rackCodeFromLabel(addressLabel || name);
  const meta = mergeRackMeta(undefined, input.meta);
  const { warehouseId, zoneId } = await resolveWarehouseZone(
    client,
    siteId,
    input.warehouseCode,
    input.zoneCode
  );

  const result = await client.query<{ rack_id: string }>(
    `INSERT INTO wms_rack_defs (
       site_id, warehouse_id, zone_id, rack_code, name, address_label, meta_json
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING rack_id::text`,
    [siteId, warehouseId, zoneId, code, name, addressLabel, JSON.stringify(meta)]
  );
  return getRackDef(client, siteId, code);
}

export async function patchRackDef(
  client: PoolClient,
  siteId: number,
  rackCode: string,
  patch: Partial<{
    name: string;
    addressLabel: string | null;
    warehouseCode: string | null;
    zoneCode: string | null;
    isActive: boolean;
    meta: RackMeta;
  }>
) {
  const existing = await client.query<{ meta_json: unknown }>(
    `SELECT COALESCE(meta_json, '{}'::jsonb) AS meta_json
     FROM wms_rack_defs WHERE site_id = $1 AND upper(rack_code) = $2`,
    [siteId, rackCode.toUpperCase()]
  );
  if (!existing.rows[0]) return null;

  const fields: string[] = [];
  const values: unknown[] = [siteId, rackCode.toUpperCase()];
  let idx = 3;

  if (typeof patch.name === "string" && patch.name.trim()) {
    fields.push(`name = $${idx++}`);
    values.push(patch.name.trim());
  }
  if (patch.addressLabel !== undefined) {
    fields.push(`address_label = $${idx++}`);
    values.push(patch.addressLabel?.trim().toUpperCase() || null);
  }
  if (patch.warehouseCode !== undefined || patch.zoneCode !== undefined) {
    const wh = patch.warehouseCode !== undefined ? patch.warehouseCode : undefined;
    const zn = patch.zoneCode !== undefined ? patch.zoneCode : undefined;
    const current = await getRackDef(client, siteId, rackCode);
    const { warehouseId, zoneId } = await resolveWarehouseZone(
      client,
      siteId,
      wh ?? current?.warehouseCode,
      zn ?? current?.zoneCode
    );
    fields.push(`warehouse_id = $${idx++}`);
    values.push(warehouseId);
    fields.push(`zone_id = $${idx++}`);
    values.push(zoneId);
  }
  if (typeof patch.isActive === "boolean") {
    fields.push(`is_active = $${idx++}`);
    values.push(patch.isActive);
  }
  if (patch.meta !== undefined) {
    const merged = mergeRackMeta(existing.rows[0].meta_json as RackMeta, patch.meta);
    fields.push(`meta_json = $${idx++}::jsonb`);
    values.push(JSON.stringify(merged));
  }
  if (fields.length === 0) return null;

  fields.push("updated_at = now()");
  await client.query(
    `UPDATE wms_rack_defs SET ${fields.join(", ")}
     WHERE site_id = $1 AND upper(rack_code) = $2`,
    values
  );
  return getRackDef(client, siteId, rackCode);
}

export async function deleteRackDef(client: PoolClient, siteId: number, rackCode: string) {
  const result = await client.query(
    `UPDATE wms_rack_defs SET is_active = false, updated_at = now()
     WHERE site_id = $1 AND upper(rack_code) = $2`,
    [siteId, rackCode.toUpperCase()]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function setRackCells(
  client: PoolClient,
  siteId: number,
  rackCode: string,
  locationCodes: string[]
) {
  const rack = await client.query<{ rack_id: string }>(
    `SELECT rack_id::text FROM wms_rack_defs
     WHERE site_id = $1 AND upper(rack_code) = $2`,
    [siteId, rackCode.toUpperCase()]
  );
  if (!rack.rows[0]) throw new Error("rack not found");
  const rackId = Number(rack.rows[0].rack_id);

  const codes = sortSequentialCellCodes([
    ...new Set(locationCodes.map((c) => c.trim().toUpperCase()).filter(Boolean)),
  ]);
  const locResult = await client.query<{ location_id: string; location_code: string }>(
    `SELECT location_id::text, location_code
     FROM wms_locations
     WHERE site_id = $1 AND upper(location_code) = ANY($2::text[])`,
    [siteId, codes]
  );
  const found = new Map(locResult.rows.map((r) => [r.location_code.toUpperCase(), Number(r.location_id)]));
  const missing = codes.filter((c) => !found.has(c));
  if (missing.length) {
    throw new Error(`ячейки не найдены: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`);
  }

  await client.query(`DELETE FROM wms_rack_cells WHERE site_id = $1 AND rack_id = $2`, [siteId, rackId]);

  let order = 0;
  for (const code of codes) {
    const locationId = found.get(code);
    if (locationId == null) continue;
    await client.query(
      `INSERT INTO wms_rack_cells (site_id, rack_id, location_id, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (site_id, location_id) DO UPDATE
         SET rack_id = EXCLUDED.rack_id, sort_order = EXCLUDED.sort_order`,
      [siteId, rackId, locationId, order++]
    );
  }

  await client.query(`UPDATE wms_rack_defs SET updated_at = now() WHERE rack_id = $1`, [rackId]);
  return getRackDef(client, siteId, rackCode);
}

export async function suggestLocationsForRack(
  client: PoolClient,
  siteId: number,
  rackCode: string
): Promise<RackCellRow[]> {
  const rack = await getRackDef(client, siteId, rackCode);
  if (!rack) throw new Error("rack not found");
  const prefix = (rack.addressLabel || rackPrefixFromPhysicalAddress(rack.name) || rack.code.replace(/^RACK_/, ""))
    .trim()
    .toUpperCase();
  if (!prefix) return [];

  const result = await client.query<{
    location_id: string;
    location_code: string;
    display_name: string;
    location_attrs_json: unknown;
  }>(
    `SELECT l.location_id::text, l.location_code, l.display_name, l.location_attrs_json
     FROM wms_locations l
     LEFT JOIN wms_rack_cells rc ON rc.location_id = l.location_id AND rc.site_id = l.site_id
     WHERE l.site_id = $1
       AND rc.rack_cell_id IS NULL
       AND (
         upper(l.location_code) LIKE '%' || $2 || '%'
         OR upper(COALESCE(l.location_attrs_json->'slotProfile'->>'physicalAddress', '')) LIKE $2 || '%'
         OR upper(COALESCE(l.location_attrs_json->'slotProfile'->>'physicalAddress', '')) LIKE $2 || '-%'
       )
     ORDER BY l.location_code ASC
     LIMIT 200`,
    [siteId, prefix]
  );

  return result.rows.map((row, i) => {
    const profile = parseSlotProfileFromAttrs(row.location_attrs_json);
    return {
      locationId: row.location_id,
      locationCode: row.location_code,
      displayName: row.display_name,
      physicalAddress: profile?.physicalAddress ?? null,
      sortOrder: i,
    };
  });
}
