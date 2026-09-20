import type { Pool, PoolClient } from "pg";
import { listItemReceivingReceipts } from "@/lib/wms/receiving-item-receipts";
import { WmsHttpError } from "@/lib/wms/errors";
import { canonicalPackagingProfile } from "@/lib/wms/packaging-profile-defs";
import { ensureItemClass, ensureItemGroup } from "@/lib/wms/item-master-refs";

function parseCursor(cursor?: string | null): number | null {
  if (!cursor) return null;
  const value = Number(cursor);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.min(Math.max(Math.trunc(limit ?? 50), 1), 300);
}

function parseOffset(offset?: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(Math.trunc(offset ?? 0), 0), 100_000);
}

export async function listItems(
  client: PoolClient,
  siteId: number,
  options: {
    query?: string;
    materialType?: string;
    /** @deprecated используйте productGroupNames + includeBareProductGroup */
    productGroup?: string;
    itemClassCode?: string;
    itemGroupCode?: string;
    itemTypeCode?: string;
    /** Скрыть этикетки/стикеры — для отгрузки готовой продукции. */
    excludeLabels?: boolean;
    isActive?: boolean | null;
    cursor?: string | null;
    limit?: number;
    offset?: number;
    /** @deprecated используйте includeBareProductGroup */
    bareProductGroup?: boolean;
    /** Имена групп (поле product_group / отображаемое имя); строка попадает в выборку, если совпала хотя бы одна. */
    productGroupNames?: string[];
    /** Включить позиции без product_group (как «Без группы» в справочнике). */
    includeBareProductGroup?: boolean;
  }
) {
  const limit = parseLimit(options.limit);
  const offset = parseOffset(options.offset);
  const cursor = offset > 0 ? null : parseCursor(options.cursor);
  const query = options.query?.trim() ?? "";
  const materialType = options.materialType?.trim() ?? "";
  const itemClassCode = options.itemClassCode?.trim() ?? "";
  const itemGroupCode = options.itemGroupCode?.trim() ?? "";
  const itemTypeCode = options.itemTypeCode?.trim() ?? "";
  const isActiveFilter =
    options.isActive === true ? true : options.isActive === false ? false : null;

  let productGroupNames = (options.productGroupNames ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let includeBareProductGroup = Boolean(options.includeBareProductGroup);
  const legacyPg = options.productGroup?.trim() ?? "";
  if (productGroupNames.length === 0 && legacyPg) productGroupNames = [legacyPg];
  if (!options.includeBareProductGroup && options.bareProductGroup) includeBareProductGroup = true;

  const applyProductGroupFilter = includeBareProductGroup || productGroupNames.length > 0;

  /**
   * Список справочника: только поля таблицы + агрегаты остатка.
   * Сроки, партии, коды ЧЗ и поставщики живут в карточке — на 37k кодов
   * коррелированные подзапросы давали ~0.4 с / 100 строк и ~2 с / 300.
   * COUNT(*) OVER() убирает второй round-trip через заводской туннель.
   */
  const r = await client.query(
    `SELECT
       i.item_id::text AS cursor,
       i.item_code AS "itemCode",
       i.short_name AS "shortName",
       i.is_active AS "isActive",
       i.item_type_code AS "itemTypeCode",
       i.sku AS "sku",
       i.name AS "name",
       i.material_type AS "materialType",
       i.product_group AS "productGroup",
       i.item_group_code AS "itemGroupCode",
       i.item_class_code AS "itemClassCode",
       i.item_subgroup AS "itemSubgroup",
       i.packaging_format AS "packagingFormat",
       i.packaging_profile AS "packagingProfile",
       i.item_attrs_json AS "itemAttrs",
       i.nomenclature AS "nomenclature",
       i.line_group AS "lineGroup",
       i.uom_code AS "uomCode",
       i.is_marked AS "isMarked",
       i.is_perishable AS "isPerishable",
       i.rotation_policy AS "rotationPolicy",
       i.shelf_life_days AS "shelfLifeDays",
       i.expiry_warning_days AS "expiryWarningDays",
       COALESCE(sb.available_qty, 0)::float8 AS "availableQty",
       COALESCE(sb.reserved_qty, 0)::float8 AS "reservedQty",
       COALESCE(sb.in_production_qty, 0)::float8 AS "inProductionQty",
       COALESCE(sb.in_transit_qty, 0)::float8 AS "inTransitQty",
       COALESCE(sb.quarantine_qty, 0)::float8 AS "quarantineQty",
       COALESCE(sb.rejected_qty, 0)::float8 AS "rejectedQty",
       COUNT(*) OVER()::int AS "_listTotal"
     FROM wms_items i
     LEFT JOIN (
       SELECT
         item_id,
         SUM(available_qty)::float8 AS available_qty,
         SUM(reserved_qty)::float8 AS reserved_qty,
         SUM(in_production_qty)::float8 AS in_production_qty,
         SUM(in_transit_qty)::float8 AS in_transit_qty,
         SUM(quarantine_qty)::float8 AS quarantine_qty,
         SUM(rejected_qty)::float8 AS rejected_qty
       FROM wms_stock_balances
       WHERE site_id = $1
       GROUP BY item_id
     ) sb ON sb.item_id = i.item_id
     WHERE i.site_id = $1
       AND ($2::text = '' OR i.name ILIKE $3 OR i.item_code ILIKE $3 OR COALESCE(i.sku, '') ILIKE $3 OR COALESCE(i.nomenclature, '') ILIKE $3)
       AND ($4::text = '' OR COALESCE(i.item_class_code, COALESCE(i.material_type, '')) = $4)
       AND (
         NOT $5::boolean
         OR (
           $6::boolean IS TRUE
           AND NULLIF(TRIM(COALESCE(i.product_group, '')), '') IS NULL
           AND NULLIF(TRIM(COALESCE(i.item_group_code, '')), '') IS NULL
         )
         OR (
           COALESCE(cardinality($7::text[]), 0) > 0
           AND COALESCE(i.item_group_code, COALESCE(i.product_group, '')) = ANY($7::text[])
         )
       )
       AND ($8::text = '' OR COALESCE(i.item_group_code, '') = $8)
       AND ($9::text = '' OR COALESCE(i.item_class_code, '') = $9)
       AND (
         $10::text = ''
         OR COALESCE(i.item_type_code, '') = ANY(string_to_array($10, ','))
       )
       AND (
         NOT $15::boolean
         OR (
           i.name !~* '^(стикер|этикетка|эмульсия)\\b'
           AND COALESCE(i.item_group_code, i.product_group, '') NOT IN ('stickers', 'labels')
           AND COALESCE(i.item_type_code, '') NOT IN ('stickers')
         )
       )
       AND ($11::boolean IS NULL OR i.is_active = $11)
       AND ($12::bigint IS NULL OR i.item_id < $12::bigint)
     ORDER BY i.item_id DESC
     LIMIT $13 OFFSET $14`,
    [
      siteId,
      query,
      `%${query}%`,
      materialType,
      applyProductGroupFilter,
      includeBareProductGroup,
      productGroupNames,
      itemGroupCode,
      itemClassCode,
      itemTypeCode,
      isActiveFilter,
      cursor,
      limit + 1,
      offset,
      Boolean(options.excludeLabels),
    ]
  );

  const total = Number(r.rows[0]?._listTotal ?? 0);
  const rows = r.rows.slice(0, limit).map((row) => {
    const { _listTotal: _ignored, ...item } = row as typeof row & { _listTotal?: number };
    void _ignored;
    return item;
  });
  const nextCursor =
    r.rows.length > limit ? (rows[rows.length - 1]?.cursor as string | undefined) : "";
  return {
    items: rows,
    nextCursor,
    total,
    limit,
    offset,
  };
}

/**
 * Один клиент выполняет запросы строго по очереди, а каждый round-trip до базы
 * на заводе стоит ~130 мс. Независимые части карточки берут свои соединения из
 * пула и выполняются одновременно.
 */
async function onOwnClient<T>(
  pool: Pool | undefined,
  fallback: PoolClient,
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!pool) return run(fallback);
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    return run(fallback);
  }
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

export async function getItemOverview(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  pool?: Pool
) {
  const item = await client.query(
    `SELECT
       i.item_id::text AS "itemId",
       i.item_code AS "itemCode",
       i.short_name AS "shortName",
       i.is_active AS "isActive",
       i.item_type_code AS "itemTypeCode",
       i.sku AS "sku",
       i.name AS "name",
       i.material_type AS "materialType",
       i.product_group AS "productGroup",
       i.item_group_code AS "itemGroupCode",
       i.item_class_code AS "itemClassCode",
       i.item_subgroup AS "itemSubgroup",
       i.packaging_format AS "packagingFormat",
       i.packaging_profile AS "packagingProfile",
       i.item_attrs_json AS "itemAttrs",
       i.nomenclature AS "nomenclature",
       i.line_group AS "lineGroup",
       i.uom_code AS "uomCode",
       i.is_marked AS "isMarked",
       i.is_perishable AS "isPerishable",
       i.rotation_policy AS "rotationPolicy",
       i.shelf_life_days AS "shelfLifeDays",
       i.expiry_warning_days AS "expiryWarningDays",
       b.barcode AS "primaryBarcode",
       (SELECT NULLIF(TRIM(COALESCE(a.supplier_name, '')), '')
        FROM wms_item_aliases a
        WHERE a.site_id = i.site_id
          AND a.item_id = i.item_id
          AND a.is_active
          AND NULLIF(TRIM(COALESCE(a.supplier_name, a.supplier_code, '')), '') IS NOT NULL
        ORDER BY a.updated_at DESC, a.alias_id DESC
        LIMIT 1
       ) AS "primarySupplierName",
       (SELECT NULLIF(TRIM(COALESCE(a.supplier_code, '')), '')
        FROM wms_item_aliases a
        WHERE a.site_id = i.site_id
          AND a.item_id = i.item_id
          AND a.is_active
          AND NULLIF(TRIM(COALESCE(a.supplier_name, a.supplier_code, '')), '') IS NOT NULL
        ORDER BY a.updated_at DESC, a.alias_id DESC
        LIMIT 1
       ) AS "primarySupplierCode",
       (SELECT string_agg(name, ' · ' ORDER BY name)
        FROM (
          SELECT DISTINCT NULLIF(TRIM(COALESCE(a.supplier_name, a.supplier_code, '')), '') AS name
          FROM wms_item_aliases a
          WHERE a.site_id = i.site_id
            AND a.item_id = i.item_id
            AND a.is_active
        ) s
        WHERE name IS NOT NULL
       ) AS "supplierNames"
     FROM wms_items i
     LEFT JOIN LATERAL (
       SELECT barcode
       FROM wms_item_barcodes
       WHERE item_id = i.item_id
       ORDER BY is_primary DESC, item_barcode_id
       LIMIT 1
     ) b ON true
     WHERE i.site_id = $1 AND i.item_code = $2`,
    [siteId, itemCode.trim()]
  );
  if (item.rows.length === 0) return null;
  const itemRow = item.rows[0];

  const activeSpecPromise = onOwnClient(pool, client, (c) =>
    c.query(
    `SELECT
       s.spec_id::text AS "specId",
       s.spec_code AS "specCode",
       s.version_no AS "versionNo",
       s.effective_from AS "effectiveFrom",
       s.comment AS "comment"
     FROM wms_item_specs s
     WHERE s.site_id = $1 AND s.parent_item_id = $2::bigint AND s.is_active
     ORDER BY s.version_no DESC
     LIMIT 1`,
      [siteId, itemRow.itemId]
    )
  );

  const stockByLocationPromise = onOwnClient(pool, client, (c) =>
    c.query(
    `SELECT
       l.location_code AS "locationCode",
       w.warehouse_code AS "warehouseCode",
       z.zone_code AS "zoneCode",
       sb.available_qty::float8 AS "availableQty",
       sb.reserved_qty::float8 AS "reservedQty",
       sb.in_production_qty::float8 AS "inProductionQty",
       sb.in_transit_qty::float8 AS "inTransitQty",
       sb.quarantine_qty::float8 AS "quarantineQty",
       sb.rejected_qty::float8 AS "rejectedQty",
       ras.code AS "accuracyStatus"
     FROM wms_stock_balances sb
     JOIN wms_locations l ON l.location_id = sb.location_id
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
     JOIN wms_zones z ON z.zone_id = l.zone_id
     JOIN ref_wms_accuracy_status ras ON ras.accuracy_status_id = sb.accuracy_status_id
     WHERE sb.site_id = $1 AND sb.item_id = $2::bigint
     ORDER BY w.warehouse_code, z.zone_code, l.location_code`,
      [siteId, itemRow.itemId]
    )
  );

  const lotsPromise = onOwnClient(pool, client, (c) =>
    c.query(
    `SELECT
       wl.lot_id::text AS "lotId",
       wl.lot_code AS "lotCode",
       wl.batch_label AS "batchLabel",
       wl.received_at AS "receivedAt",
       wl.manufactured_at AS "manufacturedAt",
       wl.best_before_at AS "bestBeforeAt",
       wl.expiry_at AS "expiryAt",
       wl.qa_status_code AS "qaStatusCode",
       wl.is_blocked AS "isBlocked",
       wl.note AS "note",
       COALESCE(SUM(sl.available_qty), 0)::float8 AS "availableQty",
       COALESCE(SUM(sl.reserved_qty), 0)::float8 AS "reservedQty",
       COALESCE(SUM(sl.in_transit_qty), 0)::float8 AS "inTransitQty",
       COALESCE(SUM(sl.quarantine_qty), 0)::float8 AS "quarantineQty",
       COALESCE(SUM(sl.rejected_qty), 0)::float8 AS "rejectedQty"
     FROM wms_lots wl
     LEFT JOIN wms_stock_lots sl ON sl.lot_id = wl.lot_id
     WHERE wl.site_id = $1 AND wl.item_id = $2::bigint
     GROUP BY wl.lot_id
     ORDER BY wl.expiry_at NULLS LAST, wl.received_at DESC`,
      [siteId, itemRow.itemId]
    )
  );

  const receiptsPromise = onOwnClient(pool, client, (c) =>
    listItemReceivingReceipts(c, siteId, itemRow.itemCode as string)
  );

  const itemUomsPromise = onOwnClient(pool, client, (c) =>
    c.query(
      `SELECT
       iu.item_uom_id::text AS "itemUomId",
       iu.uom_code AS "uomCode",
       iu.uom_name AS "uomName",
       iu.qty_in_base::float8 AS "qtyInBase",
       iu.level_no AS "levelNo",
       iu.is_base AS "isBase",
       iu.is_shipping AS "isShipping",
       iu.max_per_load_unit::float8 AS "maxPerLoadUnit",
       iu.weight_kg::float8 AS "weightKg",
       iu.volume_l::float8 AS "volumeL"
     FROM wms_item_uoms iu
     WHERE iu.item_id = $1::bigint
     ORDER BY iu.qty_in_base DESC, iu.level_no DESC, iu.uom_code`,
      [itemRow.itemId]
    )
  );

  const [activeSpec, stockByLocation, lots, receivingReceipts, itemUomsResult] =
    await Promise.all([
      activeSpecPromise,
      stockByLocationPromise,
      lotsPromise,
      receiptsPromise,
      itemUomsPromise,
    ]);

  const totals = stockByLocation.rows.reduce(
    (acc, row) => {
      acc.availableQty += Number(row.availableQty ?? 0);
      acc.reservedQty += Number(row.reservedQty ?? 0);
      acc.inProductionQty += Number(row.inProductionQty ?? 0);
      acc.inTransitQty += Number(row.inTransitQty ?? 0);
      acc.quarantineQty += Number(row.quarantineQty ?? 0);
      acc.rejectedQty += Number(row.rejectedQty ?? 0);
      return acc;
    },
    {
      availableQty: 0,
      reservedQty: 0,
      inProductionQty: 0,
      inTransitQty: 0,
      quarantineQty: 0,
      rejectedQty: 0,
    }
  );

  return {
    item: itemRow,
    activeSpec: activeSpec.rows[0] ?? null,
    totals,
    stockByLocation: stockByLocation.rows,
    lots: lots.rows,
    receivingReceipts,
    itemUoms: itemUomsResult.rows,
  };
}

export async function getItemResources(
  client: PoolClient,
  siteId: number,
  itemCode: string
) {
  const item = await client.query<{ item_id: string }>(
    `SELECT item_id::text AS item_id
     FROM wms_items
     WHERE site_id = $1 AND item_code = $2`,
    [siteId, itemCode.trim()]
  );
  const itemId = item.rows[0]?.item_id;
  if (!itemId) return null;

  const resources = await client.query(
    `WITH active_spec AS (
       SELECT spec_id
       FROM wms_item_specs
       WHERE site_id = $1 AND parent_item_id = $2::bigint AND is_active
       ORDER BY version_no DESC
       LIMIT 1
     )
     SELECT
       sc.spec_component_id::text AS "specComponentId",
       c.item_code AS "itemCode",
       c.name AS "name",
       c.material_type AS "materialType",
       c.product_group AS "productGroup",
       sc.component_role_code AS "componentRoleCode",
       sc.qty_per::float8 AS "qtyPer",
       sc.uom_code AS "uomCode",
       COALESCE(SUM(sb.available_qty), 0)::float8 AS "availableQty",
       COALESCE(SUM(sb.reserved_qty), 0)::float8 AS "reservedQty",
       COALESCE(SUM(sb.in_production_qty), 0)::float8 AS "inProductionQty",
       COALESCE(SUM(sb.in_transit_qty), 0)::float8 AS "inTransitQty",
       COALESCE(SUM(sb.quarantine_qty), 0)::float8 AS "quarantineQty",
       COALESCE(SUM(sb.rejected_qty), 0)::float8 AS "rejectedQty",
       MIN(wl.expiry_at) AS "earliestExpiryAt",
       COUNT(DISTINCT wl.lot_id)::int AS "lotCount"
     FROM active_spec s
     JOIN wms_item_spec_components sc ON sc.spec_id = s.spec_id
     JOIN wms_items c ON c.item_id = sc.component_item_id
     LEFT JOIN wms_stock_balances sb ON sb.site_id = $1 AND sb.item_id = c.item_id
     LEFT JOIN wms_lots wl ON wl.site_id = $1 AND wl.item_id = c.item_id
     GROUP BY sc.spec_component_id, c.item_id
     ORDER BY sc.sort_order, c.item_code`,
    [siteId, itemId]
  );

  return { resources: resources.rows };
}

export type ItemResourcePatchRow = {
  itemCode: string;
  qtyPer: number;
  uomCode?: string | null;
  componentRoleCode?: string | null;
};

export async function replaceItemResources(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  components: ItemResourcePatchRow[]
) {
  const parent = await client.query<{ item_id: string; item_code: string }>(
    `SELECT item_id::text AS item_id, item_code
     FROM wms_items
     WHERE site_id = $1 AND item_code = $2`,
    [siteId, itemCode.trim()]
  );
  const parentRow = parent.rows[0];
  if (!parentRow) return { updated: false as const };

  const normalized = components.map((row, idx) => {
    const componentItemCode = row.itemCode.trim();
    const qtyPer = Number(row.qtyPer);
    const uomCode = (row.uomCode || "pcs").trim() || "pcs";
    const componentRoleCode = (row.componentRoleCode || "material").trim() || "material";
    if (!componentItemCode) {
      throw new WmsHttpError(400, `component ${idx + 1}: itemCode is required`, "invalid_component");
    }
    if (componentItemCode === parentRow.item_code) {
      throw new WmsHttpError(400, "product cannot be a component of itself", "invalid_component");
    }
    if (!Number.isFinite(qtyPer) || qtyPer <= 0) {
      throw new WmsHttpError(400, `component ${idx + 1}: qtyPer must be > 0`, "invalid_qty");
    }
    return { componentItemCode, qtyPer, uomCode, componentRoleCode, sortOrder: (idx + 1) * 10 };
  });

  const seen = new Set<string>();
  for (const row of normalized) {
    const key = row.componentItemCode.toUpperCase();
    if (seen.has(key)) {
      throw new WmsHttpError(400, `duplicate component ${row.componentItemCode}`, "duplicate_component");
    }
    seen.add(key);
  }

  await client.query("BEGIN");
  try {
    if (normalized.length === 0) {
      await client.query(
        `UPDATE wms_item_specs
         SET is_active = false,
             effective_to = COALESCE(effective_to, now())
         WHERE site_id = $1 AND parent_item_id = $2::bigint AND is_active`,
        [siteId, parentRow.item_id]
      );
      await client.query("COMMIT");
      return { updated: true as const };
    }

    const spec = await client.query<{ spec_id: string }>(
      `SELECT spec_id::text AS spec_id
       FROM wms_item_specs
       WHERE site_id = $1 AND parent_item_id = $2::bigint AND is_active
       ORDER BY version_no DESC
       LIMIT 1`,
      [siteId, parentRow.item_id]
    );

    let specId = spec.rows[0]?.spec_id;
    if (!specId) {
      const nextVersion = await client.query<{ version_no: number }>(
        `SELECT COALESCE(MAX(version_no), 0) + 1 AS version_no
         FROM wms_item_specs
         WHERE parent_item_id = $1::bigint`,
        [parentRow.item_id]
      );
      const versionNo = Number(nextVersion.rows[0]?.version_no ?? 1);
      const created = await client.query<{ spec_id: string }>(
        `INSERT INTO wms_item_specs
           (site_id, parent_item_id, spec_code, version_no, is_active, comment)
         VALUES ($1, $2::bigint, $3, $4, true, $5)
         RETURNING spec_id::text AS spec_id`,
        [siteId, parentRow.item_id, `${parentRow.item_code}-SPEC-${versionNo}`, versionNo, "WMS manual composition"]
      );
      specId = created.rows[0]?.spec_id;
    }
    if (!specId) throw new WmsHttpError(500, "failed to create spec", "spec_create_failed");

    await client.query(`DELETE FROM wms_item_spec_components WHERE spec_id = $1::bigint`, [specId]);

    for (const row of normalized) {
      const component = await client.query<{ item_id: string }>(
        `SELECT item_id::text AS item_id
         FROM wms_items
         WHERE site_id = $1 AND item_code = $2`,
        [siteId, row.componentItemCode]
      );
      const componentItemId = component.rows[0]?.item_id;
      if (!componentItemId) {
        throw new WmsHttpError(400, `component not found: ${row.componentItemCode}`, "component_not_found");
      }
      await client.query(
        `INSERT INTO wms_item_spec_components
           (spec_id, component_item_id, component_role_code, qty_per, uom_code, sort_order)
         VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6)`,
        [specId, componentItemId, row.componentRoleCode, row.qtyPer, row.uomCode, row.sortOrder]
      );
    }

    await client.query(`UPDATE wms_item_specs SET effective_to = NULL WHERE spec_id = $1::bigint`, [specId]);
    await client.query("COMMIT");
    return { updated: true as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function listItemRecentMovements(
  client: PoolClient,
  siteId: number,
  itemId: string,
  limit = 20
) {
  const { movements } = await listItemMovements(client, siteId, itemId, { limit, offset: 0 });
  return movements;
}

export async function listItemMovements(
  client: PoolClient,
  siteId: number,
  itemId: string,
  opts: { limit?: number; offset?: number; days?: number | null } = {}
) {
  const limit = Math.min(Math.max(Math.trunc(Number(opts.limit) || 40), 1), 100);
  const offset = Math.max(Math.trunc(Number(opts.offset) || 0), 0);
  const days =
    opts.days == null ? null : Math.min(Math.max(Math.trunc(Number(opts.days) || 0), 1), 3650);

  const params: unknown[] = [siteId, itemId];
  let dayFilter = "";
  if (days != null) {
    params.push(days);
    dayFilter = ` AND m.movement_at >= now() - make_interval(days => $${params.length}::int)`;
  }
  params.push(limit + 1, offset);

  const r = await client.query(
    `SELECT
       m.movement_id::text AS "movementId",
       m.movement_at AS "movementAt",
       mt.code AS "movementType",
       m.qty::float8 AS "qty",
       fl.location_code AS "fromLocationCode",
       tl.location_code AS "toLocationCode",
       wl.lot_code AS "lotCode",
       d.document_id::text AS "documentId"
     FROM wms_stock_movements m
     JOIN ref_wms_movement_type mt ON mt.movement_type_id = m.movement_type_id
     LEFT JOIN wms_locations fl ON fl.location_id = m.from_location_id
     LEFT JOIN wms_locations tl ON tl.location_id = m.to_location_id
     LEFT JOIN wms_lots wl ON wl.lot_id = m.lot_id
     LEFT JOIN wms_documents d ON d.document_id = m.document_id
     WHERE m.site_id = $1 AND m.item_id = $2::bigint${dayFilter}
     ORDER BY m.movement_at DESC, m.movement_id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const hasMore = r.rows.length > limit;
  return { movements: hasMore ? r.rows.slice(0, limit) : r.rows, hasMore };
}

export async function checkItemDuplicates(
  client: PoolClient,
  siteId: number,
  input: { itemCode?: string; gtin?: string; excludeItemId?: string }
): Promise<{ field: string; value: string; itemCode: string } | null> {
  // itemCode is UNIQUE(site_id, item_code) and import upserts on it.
  // Flagging "code already exists" always hits the row being saved.
  void input.itemCode;
  const gtin = input.gtin?.trim() ?? "";
  if (gtin) {
    const r = await client.query<{ item_code: string; gtin: string }>(
      `SELECT i.item_code, a.gtin
       FROM wms_item_aliases a
       JOIN wms_items i ON i.item_id = a.item_id AND i.site_id = a.site_id
       WHERE a.site_id = $1 AND a.gtin = $2
         AND i.item_id IS DISTINCT FROM $3::bigint
       LIMIT 1`,
      [siteId, gtin, input.excludeItemId ?? null]
    );
    if (r.rows[0]) {
      return { field: "gtin", value: gtin, itemCode: r.rows[0].item_code };
    }
    const bc = await client.query<{ item_code: string }>(
      `SELECT i.item_code
       FROM wms_item_barcodes b
       JOIN wms_items i ON i.item_id = b.item_id
       WHERE i.site_id = $1 AND b.barcode = $2
         AND i.item_id IS DISTINCT FROM $3::bigint
       LIMIT 1`,
      [siteId, gtin, input.excludeItemId ?? null]
    );
    if (bc.rows[0]) {
      return { field: "gtin", value: gtin, itemCode: bc.rows[0].item_code };
    }
  }
  return null;
}

export type ItemMasterPatch = {
  name?: string;
  shortName?: string | null;
  isActive?: boolean;
  itemTypeCode?: string | null;
  sku?: string | null;
  materialType?: string | null;
  productGroup?: string | null;
  itemGroupCode?: string | null;
  itemClassCode?: string | null;
  itemSubgroup?: string | null;
  packagingFormat?: string | null;
  packagingProfile?: string | null;
  nomenclature?: string | null;
  lineGroup?: string | null;
  uomCode?: string;
  isMarked?: boolean;
  isPerishable?: boolean;
  rotationPolicy?: "fifo" | "fefo" | "manual";
  shelfLifeDays?: number | null;
  expiryWarningDays?: number | null;
  itemAttrs?: Record<string, unknown> | null;
};

const ROTATION = new Set(["fifo", "fefo", "manual"]);

/**
 * Update editable master-data fields for `wms_items`. Does not change `item_code` and does not
 * adjust stock balances (those follow documents / stock movements).
 */
export async function updateItemMaster(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  patch: ItemMasterPatch
) {
  const setParts: string[] = [];
  const setVals: unknown[] = [];

  const setStr = (col: string, val: unknown) => {
    if (val === undefined) return;
    setVals.push(val);
    setParts.push(`${col} = $${setVals.length}`);
  };

  if (typeof patch.name === "string" && patch.name.trim()) {
    setStr("name", patch.name.trim());
  } else if (patch.name !== undefined) {
    throw new WmsHttpError(400, "name must be a non-empty string if provided", "invalid_name");
  }

  if ("shortName" in patch) {
    if (patch.shortName === null || typeof patch.shortName === "string")
      setStr("short_name", patch.shortName);
    else throw new WmsHttpError(400, "invalid shortName", "invalid_field");
  }
  if (typeof patch.isActive === "boolean") setStr("is_active", patch.isActive);
  else if (patch.isActive !== undefined)
    throw new WmsHttpError(400, "isActive must be boolean", "invalid_field");
  if ("itemTypeCode" in patch) {
    if (patch.itemTypeCode === null || typeof patch.itemTypeCode === "string")
      setStr("item_type_code", patch.itemTypeCode);
    else throw new WmsHttpError(400, "invalid itemTypeCode", "invalid_field");
  }
  if ("sku" in patch) {
    if (patch.sku === null || typeof patch.sku === "string") setStr("sku", patch.sku);
    else throw new WmsHttpError(400, "invalid sku", "invalid_sku");
  }
  if ("materialType" in patch) {
    if (patch.materialType === null || typeof patch.materialType === "string")
      setStr("material_type", patch.materialType);
    else throw new WmsHttpError(400, "invalid materialType", "invalid_field");
  }
  if ("productGroup" in patch) {
    if (patch.productGroup === null || typeof patch.productGroup === "string")
      setStr("product_group", patch.productGroup);
    else throw new WmsHttpError(400, "invalid productGroup", "invalid_field");
  }
  if ("itemGroupCode" in patch) {
    if (patch.itemGroupCode === null || typeof patch.itemGroupCode === "string")
      setStr("item_group_code", patch.itemGroupCode);
    else throw new WmsHttpError(400, "invalid itemGroupCode", "invalid_field");
  }
  if ("itemClassCode" in patch) {
    if (patch.itemClassCode === null || typeof patch.itemClassCode === "string")
      setStr("item_class_code", patch.itemClassCode);
    else throw new WmsHttpError(400, "invalid itemClassCode", "invalid_field");
  }
  if ("itemSubgroup" in patch) {
    if (patch.itemSubgroup === null || typeof patch.itemSubgroup === "string")
      setStr("item_subgroup", patch.itemSubgroup);
    else throw new WmsHttpError(400, "invalid itemSubgroup", "invalid_field");
  }
  if ("packagingFormat" in patch) {
    if (patch.packagingFormat === null || typeof patch.packagingFormat === "string")
      setStr("packaging_format", patch.packagingFormat);
    else throw new WmsHttpError(400, "invalid packagingFormat", "invalid_field");
  }
  if ("nomenclature" in patch) {
    if (patch.nomenclature === null || typeof patch.nomenclature === "string")
      setStr("nomenclature", patch.nomenclature);
    else throw new WmsHttpError(400, "invalid nomenclature", "invalid_field");
  }
  if ("lineGroup" in patch) {
    if (patch.lineGroup === null || typeof patch.lineGroup === "string")
      setStr("line_group", patch.lineGroup);
    else throw new WmsHttpError(400, "invalid lineGroup", "invalid_field");
  }
  if (typeof patch.uomCode === "string" && patch.uomCode.trim()) {
    setStr("uom_code", patch.uomCode.trim());
  } else if (patch.uomCode !== undefined) {
    throw new WmsHttpError(400, "uomCode must be a non-empty string if provided", "invalid_uom");
  }

  if (typeof patch.isMarked === "boolean") setStr("is_marked", patch.isMarked);
  else if (patch.isMarked !== undefined) throw new WmsHttpError(400, "isMarked must be boolean", "invalid_field");

  if (typeof patch.isPerishable === "boolean") setStr("is_perishable", patch.isPerishable);
  else if (patch.isPerishable !== undefined) throw new WmsHttpError(400, "isPerishable must be boolean", "invalid_field");

  if (patch.packagingProfile !== undefined) {
    if (patch.packagingProfile === null) {
      // column NOT NULL: ignore null, do not update
    } else if (typeof patch.packagingProfile === "string" && patch.packagingProfile.trim()) {
      const canon = await canonicalPackagingProfile(client, siteId, patch.packagingProfile.trim());
      setStr("packaging_profile", canon);
    } else {
      throw new WmsHttpError(400, "invalid packagingProfile", "invalid_field");
    }
  }

  if (patch.rotationPolicy !== undefined) {
    if (typeof patch.rotationPolicy === "string" && ROTATION.has(patch.rotationPolicy)) {
      setStr("rotation_policy", patch.rotationPolicy);
    } else {
      throw new WmsHttpError(400, "invalid rotationPolicy", "invalid_field");
    }
  }

  if ("shelfLifeDays" in patch) {
    if (patch.shelfLifeDays === null) setStr("shelf_life_days", null);
    else if (
      typeof patch.shelfLifeDays === "number" &&
      Number.isFinite(patch.shelfLifeDays) &&
      patch.shelfLifeDays >= 0
    ) {
      setStr("shelf_life_days", Math.trunc(patch.shelfLifeDays));
    } else {
      throw new WmsHttpError(400, "invalid shelfLifeDays", "invalid_field");
    }
  }
  if ("expiryWarningDays" in patch) {
    if (patch.expiryWarningDays === null) setStr("expiry_warning_days", null);
    else if (
      typeof patch.expiryWarningDays === "number" &&
      Number.isFinite(patch.expiryWarningDays) &&
      patch.expiryWarningDays >= 0
    ) {
      setStr("expiry_warning_days", Math.trunc(patch.expiryWarningDays));
    } else {
      throw new WmsHttpError(400, "invalid expiryWarningDays", "invalid_field");
    }
  }

  if ("itemAttrs" in patch) {
    if (patch.itemAttrs === null) {
      setStr("item_attrs_json", null);
    } else if (typeof patch.itemAttrs === "object" && patch.itemAttrs !== null) {
      setStr("item_attrs_json", patch.itemAttrs);
    } else {
      throw new WmsHttpError(400, "itemAttrs must be an object, null, or undefined", "invalid_field");
    }
  }

  if (setParts.length === 0) {
    throw new WmsHttpError(400, "no fields to update", "no_patch_fields");
  }

  if ("itemGroupCode" in patch && patch.itemGroupCode) {
    await ensureItemGroup(client, siteId, patch.itemGroupCode, patch.itemGroupCode);
  }
  if ("itemClassCode" in patch && patch.itemClassCode) {
    let grp: string | null =
      "itemGroupCode" in patch ? (patch.itemGroupCode ?? null) : null;
    if (!("itemGroupCode" in patch)) {
      const cur = await client.query<{ item_group_code: string | null }>(
        `SELECT item_group_code FROM wms_items WHERE site_id = $1 AND item_code = $2`,
        [siteId, itemCode.trim()]
      );
      grp = cur.rows[0]?.item_group_code ?? null;
    }
    await ensureItemClass(client, siteId, patch.itemClassCode, grp, patch.itemClassCode);
  }

  setVals.push(siteId, itemCode.trim());
  const pSite = setVals.length - 1;
  const pCode = setVals.length;
  const sql = `UPDATE wms_items
     SET ${setParts.join(", ")},
         updated_at = now()
     WHERE site_id = $${pSite} AND item_code = $${pCode}`;

  const r = await client.query(sql, setVals);
  if (r.rowCount === 0) {
    return { updated: false as const };
  }
  return { updated: true as const };
}

export async function getItemWhereUsed(
  client: PoolClient,
  siteId: number,
  componentItemCode: string
) {
  const it = await client.query<{ item_id: string }>(
    `SELECT item_id::text AS item_id
     FROM wms_items
     WHERE site_id = $1 AND item_code = $2`,
    [siteId, componentItemCode.trim()]
  );
  const componentItemId = it.rows[0]?.item_id;
  if (!componentItemId) return null;

  const r = await client.query(
    `SELECT
       p.item_code AS "itemCode",
       p.name AS "name",
       p.material_type AS "materialType",
       p.product_group AS "productGroup",
       s.spec_code AS "specCode",
       s.version_no AS "versionNo",
       sc.component_role_code AS "componentRoleCode",
       sc.qty_per::float8 AS "qtyPer",
       sc.uom_code AS "uomCode"
     FROM wms_item_spec_components sc
     JOIN wms_item_specs s ON s.spec_id = sc.spec_id
     JOIN wms_items p ON p.item_id = s.parent_item_id
     WHERE s.site_id = $1
       AND s.is_active
       AND sc.component_item_id = $2::bigint
     ORDER BY p.item_code`,
    [siteId, componentItemId]
  );

  return { whereUsed: r.rows };
}
