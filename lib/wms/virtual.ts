import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { resolveItemByCodeOrBarcode, resolveLocation, resolveWarehouse } from "@/lib/wms/resolve";

type VirtualNodeType = "room" | "rack" | "shelf" | "pallet" | "box" | "bin" | "container" | "pallet_slot";

type UpsertLayoutInput = {
  siteCode: string;
  layoutCode: string;
  name: string;
  warehouseCode?: string;
  zoneCode?: string;
  description?: string;
  scenePrefs?: Record<string, unknown> | null;
};

type UpsertNodeInput = {
  layoutId: string;
  parentNodeId?: string | null;
  nodeType: VirtualNodeType;
  code?: string;
  label: string;
  posX?: number;
  posY?: number;
  posZ?: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  sortOrder?: number;
  props?: Record<string, unknown> | null;
};

function numeric(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function listVirtualLayouts(
  client: PoolClient,
  siteId: number,
  options?: { warehouseCode?: string; query?: string }
) {
  const warehouseCode = options?.warehouseCode?.trim() ?? "";
  const query = options?.query?.trim() ?? "";
  const r = await client.query(
    `SELECT
       l.layout_id::text AS "layoutId",
       l.layout_code AS "layoutCode",
       l.name AS "name",
       l.description AS "description",
       w.warehouse_code AS "warehouseCode",
       z.zone_code AS "zoneCode",
       l.scene_prefs_json AS "scenePrefs",
       l.updated_at AS "updatedAt",
       COUNT(n.node_id)::int AS "nodeCount"
     FROM wms_virtual_layouts l
     LEFT JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
     LEFT JOIN wms_zones z ON z.zone_id = l.zone_id
     LEFT JOIN wms_virtual_nodes n ON n.layout_id = l.layout_id
     WHERE l.site_id = $1
       AND ($2::text = '' OR COALESCE(w.warehouse_code, '') = $2)
       AND (
         $3::text = ''
         OR l.layout_code ILIKE $4
         OR l.name ILIKE $4
         OR COALESCE(l.description, '') ILIKE $4
       )
     GROUP BY l.layout_id, w.warehouse_code, z.zone_code
     ORDER BY l.updated_at DESC, l.layout_code`,
    [siteId, warehouseCode, query, `%${query}%`]
  );
  return { layouts: r.rows };
}

export async function upsertVirtualLayout(
  client: PoolClient,
  siteId: number,
  input: UpsertLayoutInput
) {
  const layoutCode = input.layoutCode.trim();
  const name = input.name.trim();
  if (!layoutCode) {
    throw new WmsHttpError(400, "layoutCode is required", "bad_layout_code");
  }
  if (!name) {
    throw new WmsHttpError(400, "name is required", "bad_layout_name");
  }

  const warehouse = input.warehouseCode?.trim()
    ? await resolveWarehouse(client, siteId, input.warehouseCode)
    : null;
  let zoneId: string | null = null;
  if (input.zoneCode?.trim()) {
    if (!warehouse) {
      throw new WmsHttpError(400, "warehouseCode is required when zoneCode is provided", "bad_zone_scope");
    }
    const zone = await client.query<{ zone_id: string }>(
      `SELECT zone_id::text AS zone_id
       FROM wms_zones
       WHERE warehouse_id = $1::bigint AND zone_code = $2`,
      [warehouse.warehouse_id, input.zoneCode.trim()]
    );
    zoneId = zone.rows[0]?.zone_id ?? null;
    if (!zoneId) {
      throw new WmsHttpError(404, `zone not found: ${input.zoneCode}`, "zone_not_found");
    }
  }

  const r = await client.query(
    `INSERT INTO wms_virtual_layouts (
       site_id, warehouse_id, zone_id, layout_code, name, description, scene_prefs_json, updated_at
     ) VALUES (
       $1, $2::bigint, $3::bigint, $4, $5, $6, $7::jsonb, now()
     )
     ON CONFLICT (site_id, layout_code)
     DO UPDATE SET
       warehouse_id = COALESCE(EXCLUDED.warehouse_id, wms_virtual_layouts.warehouse_id),
       zone_id = COALESCE(EXCLUDED.zone_id, wms_virtual_layouts.zone_id),
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       scene_prefs_json = COALESCE(EXCLUDED.scene_prefs_json, wms_virtual_layouts.scene_prefs_json),
       updated_at = now()
     RETURNING layout_id::text AS "layoutId"`,
    [
      siteId,
      warehouse?.warehouse_id ?? null,
      zoneId,
      layoutCode,
      name,
      input.description?.trim() || null,
      input.scenePrefs ? JSON.stringify(input.scenePrefs) : null,
    ]
  );
  return getVirtualLayout(client, siteId, r.rows[0].layoutId);
}

export async function getVirtualLayout(
  client: PoolClient,
  siteId: number,
  layoutId: string,
  options?: { includeContents?: boolean }
) {
  const layout = await client.query(
    `SELECT
       l.layout_id::text AS "layoutId",
       l.layout_code AS "layoutCode",
       l.name AS "name",
       l.description AS "description",
       w.warehouse_code AS "warehouseCode",
       z.zone_code AS "zoneCode",
       l.scene_prefs_json AS "scenePrefs",
       l.updated_at AS "updatedAt"
     FROM wms_virtual_layouts l
     LEFT JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
     LEFT JOIN wms_zones z ON z.zone_id = l.zone_id
     WHERE l.site_id = $1 AND l.layout_id = $2::bigint`,
    [siteId, layoutId]
  );
  if (layout.rows.length === 0) return null;

  const nodes = await client.query(
    `SELECT
       n.node_id::text AS "nodeId",
       n.parent_node_id::text AS "parentNodeId",
       n.node_type AS "nodeType",
       n.code AS "code",
       n.label AS "label",
       n.pos_x::float8 AS "posX",
       n.pos_y::float8 AS "posY",
       n.pos_z::float8 AS "posZ",
       n.rot_x::float8 AS "rotX",
       n.rot_y::float8 AS "rotY",
       n.rot_z::float8 AS "rotZ",
       n.size_x::float8 AS "sizeX",
       n.size_y::float8 AS "sizeY",
       n.size_z::float8 AS "sizeZ",
       n.sort_order AS "sortOrder",
       n.props_json AS "props",
       lnk.location_id::text AS "locationId",
       loc.location_code AS "locationCode",
       lnk.item_id::text AS "linkedItemId",
       li.item_code AS "linkedItemCode",
       lnk.load_unit_id::text AS "loadUnitId",
       lu.load_unit_code AS "loadUnitCode",
       lu.load_unit_type AS "loadUnitType",
       lnk.task_id::text AS "taskId"
       , COALESCE(ls.available_qty, 0)::float8 AS "locationAvailableQty"
       , COALESCE(ls.reserved_qty, 0)::float8 AS "locationReservedQty"
       , COALESCE(ls.sku_count, 0)::int AS "locationSkuCount"
     FROM wms_virtual_nodes n
     LEFT JOIN wms_virtual_links lnk ON lnk.node_id = n.node_id
     LEFT JOIN wms_locations loc ON loc.location_id = lnk.location_id
     LEFT JOIN wms_items li ON li.item_id = lnk.item_id
     LEFT JOIN wms_load_units lu ON lu.load_unit_id = lnk.load_unit_id
     LEFT JOIN LATERAL (
       SELECT
         SUM(sb.available_qty) AS available_qty,
         SUM(sb.reserved_qty) AS reserved_qty,
         COUNT(*) AS sku_count
       FROM wms_stock_balances sb
       WHERE sb.site_id = $2
         AND sb.location_id = lnk.location_id
     ) ls ON true
     WHERE n.layout_id = $1::bigint
     ORDER BY n.sort_order, n.node_id`,
    [layoutId, siteId]
  );

  const includeContents = options?.includeContents !== false;
  const contents = includeContents
    ? await client.query(
    `SELECT
       c.virtual_content_id::text AS "virtualContentId",
       c.node_id::text AS "nodeId",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       wl.lot_code AS "lotCode",
       i.is_perishable AS "isPerishable",
       i.rotation_policy AS "rotationPolicy",
       i.expiry_warning_days AS "expiryWarningDays",
       wl.best_before_at AS "bestBeforeAt",
       wl.expiry_at AS "expiryAt",
       c.qty::float8 AS "qty",
       c.uom_code AS "uomCode",
       c.note AS "note",
       c.sort_order AS "sortOrder"
       , sb.available_qty::float8 AS "locationAvailableQty"
       , sb.reserved_qty::float8 AS "locationReservedQty"
     FROM wms_virtual_contents c
     JOIN wms_virtual_nodes n ON n.node_id = c.node_id
     JOIN wms_items i ON i.item_id = c.item_id
     LEFT JOIN wms_lots wl ON wl.lot_id = c.lot_id
     LEFT JOIN wms_virtual_links lnk ON lnk.node_id = n.node_id
     LEFT JOIN wms_stock_balances sb
       ON sb.site_id = $2 AND sb.location_id = lnk.location_id AND sb.item_id = c.item_id
     WHERE n.layout_id = $1::bigint
     ORDER BY c.sort_order, c.virtual_content_id`,
    [layoutId, siteId]
    )
    : { rows: [] as any[] };

  return {
    layout: layout.rows[0],
    nodes: nodes.rows,
    contents: contents.rows,
  };
}

export async function listVirtualNodeContents(
  client: PoolClient,
  siteId: number,
  nodeId: string
) {
  const contents = await client.query(
    `SELECT
       c.virtual_content_id::text AS "virtualContentId",
       c.node_id::text AS "nodeId",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       wl.lot_code AS "lotCode",
       i.is_perishable AS "isPerishable",
       i.rotation_policy AS "rotationPolicy",
       i.expiry_warning_days AS "expiryWarningDays",
       wl.best_before_at AS "bestBeforeAt",
       wl.expiry_at AS "expiryAt",
       c.qty::float8 AS "qty",
       c.uom_code AS "uomCode",
       c.note AS "note",
       c.sort_order AS "sortOrder"
       , sb.available_qty::float8 AS "locationAvailableQty"
       , sb.reserved_qty::float8 AS "locationReservedQty"
     FROM wms_virtual_contents c
     JOIN wms_virtual_nodes n ON n.node_id = c.node_id
     JOIN wms_items i ON i.item_id = c.item_id
     LEFT JOIN wms_lots wl ON wl.lot_id = c.lot_id
     LEFT JOIN wms_virtual_links lnk ON lnk.node_id = n.node_id
     LEFT JOIN wms_stock_balances sb
       ON sb.site_id = $2 AND sb.location_id = lnk.location_id AND sb.item_id = c.item_id
     WHERE c.node_id = $1::bigint
     ORDER BY c.sort_order, c.virtual_content_id`,
    [nodeId, siteId]
  );
  return { contents: contents.rows };
}

export async function deleteVirtualLayout(
  client: PoolClient,
  siteId: number,
  layoutId: string
) {
  const r = await client.query(
    `DELETE FROM wms_virtual_layouts
     WHERE site_id = $1 AND layout_id = $2::bigint
     RETURNING layout_id::text AS "layoutId"`,
    [siteId, layoutId]
  );
  if (r.rows.length === 0) {
    throw new WmsHttpError(404, "layout not found", "layout_not_found");
  }
  return { layoutId };
}

export async function createVirtualNode(
  client: PoolClient,
  siteId: number,
  input: UpsertNodeInput
) {
  const layout = await client.query<{ layout_id: string }>(
    `SELECT layout_id::text AS layout_id
     FROM wms_virtual_layouts
     WHERE site_id = $1 AND layout_id = $2::bigint`,
    [siteId, input.layoutId]
  );
  if (!layout.rows[0]?.layout_id) {
    throw new WmsHttpError(404, "layout not found", "layout_not_found");
  }
  if (!input.label.trim()) {
    throw new WmsHttpError(400, "label is required", "bad_node_label");
  }

  const r = await client.query(
    `INSERT INTO wms_virtual_nodes (
       layout_id, parent_node_id, node_type, code, label,
       pos_x, pos_y, pos_z, rot_x, rot_y, rot_z, size_x, size_y, size_z,
       sort_order, props_json, updated_at
     ) VALUES (
       $1::bigint, $2::bigint, $3, $4, $5,
       $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16::jsonb, now()
     )
     RETURNING node_id::text AS "nodeId"`,
    [
      input.layoutId,
      input.parentNodeId ?? null,
      input.nodeType,
      input.code?.trim() || null,
      input.label.trim(),
      numeric(input.posX, 0),
      numeric(input.posY, 0),
      numeric(input.posZ, 0),
      numeric(input.rotX, 0),
      numeric(input.rotY, 0),
      numeric(input.rotZ, 0),
      numeric(input.sizeX, 1),
      numeric(input.sizeY, 1),
      numeric(input.sizeZ, 1),
      Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder as number) : 100,
      input.props ? JSON.stringify(input.props) : null,
    ]
  );
  return { nodeId: r.rows[0].nodeId };
}

export async function updateVirtualNode(
  client: PoolClient,
  siteId: number,
  nodeId: string,
  input: Partial<Omit<UpsertNodeInput, "layoutId" | "nodeType">> & {
    props?: Record<string, unknown> | null;
    locationCode?: string | null;
    parentNodeId?: string | null;
    loadUnitCode?: string | null;
  }
) {
  const existing = await client.query<{ layout_id: string }>(
    `SELECT n.layout_id::text AS layout_id
     FROM wms_virtual_nodes n
     JOIN wms_virtual_layouts l ON l.layout_id = n.layout_id
     WHERE n.node_id = $1::bigint AND l.site_id = $2`,
    [nodeId, siteId]
  );
  if (!existing.rows[0]?.layout_id) {
    throw new WmsHttpError(404, "node not found", "node_not_found");
  }

  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  let index = 1;
  const push = (sql: string, value: string | number | null) => {
    sets.push(sql.replace("?", `$${index}`));
    values.push(value);
    index += 1;
  };

  if (typeof input.parentNodeId !== "undefined") push("parent_node_id = ?::bigint", input.parentNodeId);
  if (typeof input.code !== "undefined") push("code = ?", input.code?.trim() || null);
  if (typeof input.label === "string") push("label = ?", input.label.trim());
  if (typeof input.posX !== "undefined") push("pos_x = ?", numeric(input.posX, 0));
  if (typeof input.posY !== "undefined") push("pos_y = ?", numeric(input.posY, 0));
  if (typeof input.posZ !== "undefined") push("pos_z = ?", numeric(input.posZ, 0));
  if (typeof input.rotX !== "undefined") push("rot_x = ?", numeric(input.rotX, 0));
  if (typeof input.rotY !== "undefined") push("rot_y = ?", numeric(input.rotY, 0));
  if (typeof input.rotZ !== "undefined") push("rot_z = ?", numeric(input.rotZ, 0));
  if (typeof input.sizeX !== "undefined") push("size_x = ?", numeric(input.sizeX, 1));
  if (typeof input.sizeY !== "undefined") push("size_y = ?", numeric(input.sizeY, 1));
  if (typeof input.sizeZ !== "undefined") push("size_z = ?", numeric(input.sizeZ, 1));
  if (typeof input.sortOrder !== "undefined") {
    push("sort_order = ?", Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder as number) : 100);
  }
  if (typeof input.props !== "undefined") {
    push("props_json = ?::jsonb", input.props ? JSON.stringify(input.props) : null);
  }

  if (sets.length > 0) {
    values.push(nodeId, siteId);
    await client.query(
      `UPDATE wms_virtual_nodes n
       SET ${sets.join(", ")}, updated_at = now()
       FROM wms_virtual_layouts l
       WHERE n.layout_id = l.layout_id
         AND n.node_id = $${index}::bigint
         AND l.site_id = $${index + 1}`,
      values
    );
  }

  if (typeof input.locationCode !== "undefined") {
    const location = input.locationCode?.trim()
      ? await resolveLocation(client, siteId, input.locationCode)
      : null;
    let loadUnitId: string | null = null;
    if (input.loadUnitCode?.trim()) {
      const lu = await client.query<{ load_unit_id: string }>(
        `SELECT load_unit_id::text AS load_unit_id
         FROM wms_load_units
         WHERE site_id = $1 AND load_unit_code = $2`,
        [siteId, input.loadUnitCode.trim()]
      );
      loadUnitId = lu.rows[0]?.load_unit_id ?? null;
      if (!loadUnitId) {
        throw new WmsHttpError(404, `load unit not found: ${input.loadUnitCode}`, "load_unit_not_found");
      }
    }
    await client.query(
      `INSERT INTO wms_virtual_links (node_id, location_id, load_unit_id, updated_at)
       VALUES ($1::bigint, $2::bigint, $3::bigint, now())
       ON CONFLICT (node_id)
       DO UPDATE SET
         location_id = EXCLUDED.location_id,
         load_unit_id = EXCLUDED.load_unit_id,
         updated_at = now()`,
      [nodeId, location?.location_id ?? null, loadUnitId]
    );
  } else if (typeof input.loadUnitCode !== "undefined") {
    let loadUnitId: string | null = null;
    if (input.loadUnitCode?.trim()) {
      const lu = await client.query<{ load_unit_id: string }>(
        `SELECT load_unit_id::text AS load_unit_id
         FROM wms_load_units
         WHERE site_id = $1 AND load_unit_code = $2`,
        [siteId, input.loadUnitCode.trim()]
      );
      loadUnitId = lu.rows[0]?.load_unit_id ?? null;
      if (!loadUnitId) {
        throw new WmsHttpError(404, `load unit not found: ${input.loadUnitCode}`, "load_unit_not_found");
      }
    }
    await client.query(
      `INSERT INTO wms_virtual_links (node_id, load_unit_id, updated_at)
       VALUES ($1::bigint, $2::bigint, now())
       ON CONFLICT (node_id)
       DO UPDATE SET load_unit_id = EXCLUDED.load_unit_id, updated_at = now()`,
      [nodeId, loadUnitId]
    );
  }

  return { nodeId };
}

export async function deleteVirtualNode(
  client: PoolClient,
  siteId: number,
  nodeId: string
) {
  const r = await client.query(
    `DELETE FROM wms_virtual_nodes n
     USING wms_virtual_layouts l
     WHERE n.layout_id = l.layout_id
       AND l.site_id = $1
       AND n.node_id = $2::bigint
     RETURNING n.node_id::text AS "nodeId"`,
    [siteId, nodeId]
  );
  if (r.rows.length === 0) {
    throw new WmsHttpError(404, "node not found", "node_not_found");
  }
  return { nodeId };
}

export async function saveVirtualNodeContents(
  client: PoolClient,
  siteId: number,
  nodeId: string,
  contents: Array<{
    itemCode: string;
    qty: number;
    uomCode?: string;
    lotCode?: string;
    note?: string;
    sortOrder?: number;
  }>
) {
  const node = await client.query(
    `SELECT n.node_id::text AS "nodeId"
     FROM wms_virtual_nodes n
     JOIN wms_virtual_layouts l ON l.layout_id = n.layout_id
     WHERE n.node_id = $1::bigint AND l.site_id = $2`,
    [nodeId, siteId]
  );
  if (!node.rows[0]?.nodeId) {
    throw new WmsHttpError(404, "node not found", "node_not_found");
  }

  await client.query(`DELETE FROM wms_virtual_contents WHERE node_id = $1::bigint`, [nodeId]);
  for (const [index, row] of contents.entries()) {
    const item = await resolveItemByCodeOrBarcode(client, siteId, row.itemCode);
    if (!item) {
      throw new WmsHttpError(404, `item not found: ${row.itemCode}`, "item_not_found");
    }
    let lotId: string | null = null;
    if (row.lotCode?.trim()) {
      const lot = await client.query<{ lot_id: string }>(
        `SELECT lot_id::text AS lot_id
         FROM wms_lots
         WHERE site_id = $1 AND item_id = $2::bigint AND lot_code = $3`,
        [siteId, item.item_id, row.lotCode.trim()]
      );
      lotId = lot.rows[0]?.lot_id ?? null;
      if (!lotId) {
        throw new WmsHttpError(404, `lot not found: ${row.lotCode}`, "lot_not_found");
      }
    }
    await client.query(
      `INSERT INTO wms_virtual_contents (
         node_id, item_id, lot_id, qty, uom_code, note, sort_order, updated_at
       ) VALUES (
         $1::bigint, $2::bigint, $3::bigint, $4, $5, $6, $7, now()
       )`,
      [
        nodeId,
        item.item_id,
        lotId,
        numeric(row.qty, 0),
        row.uomCode?.trim() || "pcs",
        row.note?.trim() || null,
        Number.isFinite(row.sortOrder) ? Math.trunc(row.sortOrder as number) : (index + 1) * 10,
      ]
    );
  }
  return { nodeId, count: contents.length };
}
