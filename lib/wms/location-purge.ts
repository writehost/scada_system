import type { PoolClient } from "pg";

/** Hard-delete locations and dependent rows (stock must already be cleared). */
export async function purgeLocationsByIds(
  client: PoolClient,
  siteId: number,
  locationIds: string[]
): Promise<string[]> {
  if (locationIds.length === 0) return [];

  await client.query(
    `UPDATE wms_item_codes
     SET current_location_id = NULL
     WHERE current_site_id = $1
       AND current_location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );

  await client.query(
    `UPDATE wms_locations
     SET parent_location_id = NULL
     WHERE parent_location_id = ANY($1::bigint[])`,
    [locationIds]
  );

  await client.query(
    `UPDATE wms_document_lines
     SET source_location_id = NULL
     WHERE source_location_id = ANY($1::bigint[])`,
    [locationIds]
  );
  await client.query(
    `UPDATE wms_document_lines
     SET target_location_id = NULL
     WHERE target_location_id = ANY($1::bigint[])`,
    [locationIds]
  );

  await client.query(
    `UPDATE wms_documents
     SET source_location_id = NULL
     WHERE site_id = $1 AND source_location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );
  await client.query(
    `UPDATE wms_documents
     SET target_location_id = NULL
     WHERE site_id = $1 AND target_location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );

  await client.query(
    `UPDATE wms_tasks
     SET source_location_id = NULL
     WHERE site_id = $1 AND source_location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );
  await client.query(
    `UPDATE wms_tasks
     SET target_location_id = NULL
     WHERE site_id = $1 AND target_location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );

  await client.query(
    `UPDATE wms_stock_movements
     SET from_location_id = NULL
     WHERE site_id = $1 AND from_location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );
  await client.query(
    `UPDATE wms_stock_movements
     SET to_location_id = NULL
     WHERE site_id = $1 AND to_location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );

  await client.query(
    `DELETE FROM wms_reservations
     WHERE site_id = $1 AND location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );

  await client.query(
    `UPDATE wms_load_units
     SET source_location_id = NULL
     WHERE site_id = $1 AND source_location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );
  await client.query(
    `UPDATE wms_load_units
     SET target_location_id = NULL
     WHERE site_id = $1 AND target_location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );

  await client.query(
    `DELETE FROM wms_production_consumptions
     WHERE site_id = $1 AND location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );

  await client.query(
    `DELETE FROM wms_revisions
     WHERE site_id = $1 AND location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );

  await client.query(
    `DELETE FROM wms_stock_lots sl
     USING wms_stock_balances sb
     WHERE sl.balance_id = sb.balance_id
       AND sb.site_id = $1
       AND sb.location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );

  await client.query(
    `DELETE FROM wms_stock_balances
     WHERE site_id = $1 AND location_id = ANY($2::bigint[])`,
    [siteId, locationIds]
  );

  await client.query(
    `DELETE FROM wms_virtual_links
     WHERE location_id = ANY($1::bigint[])`,
    [locationIds]
  );

  await client.query(
    `DELETE FROM wms_rack_cells
     WHERE location_id = ANY($1::bigint[])`,
    [locationIds]
  );

  const del = await client.query<{ location_code: string }>(
    `DELETE FROM wms_locations
     WHERE site_id = $1 AND location_id = ANY($2::bigint[])
     RETURNING location_code`,
    [siteId, locationIds]
  );

  return del.rows.map((r) => r.location_code);
}

export class LocationDeleteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocationDeleteBlockedError";
  }
}

export async function assertLocationDeletable(
  client: PoolClient,
  siteId: number,
  locationId: string
): Promise<void> {
  const stock = await client.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM wms_stock_balances sb
     WHERE sb.site_id = $1 AND sb.location_id = $2::bigint
       AND (
         COALESCE(sb.available_qty, 0)
         + COALESCE(sb.reserved_qty, 0)
         + COALESCE(sb.in_production_qty, 0)
         + COALESCE(sb.quarantine_qty, 0)
         + COALESCE(sb.rejected_qty, 0)
       ) > 0`,
    [siteId, locationId]
  );
  const stockCount = Number(stock.rows[0]?.cnt) || 0;
  if (stockCount > 0) {
    throw new LocationDeleteBlockedError(
      "Нельзя удалить ячейку: в ней есть остатки. Сначала переместите или спишите товар."
    );
  }

  const children = await client.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM wms_locations
     WHERE site_id = $1 AND parent_location_id = $2::bigint`,
    [siteId, locationId]
  );
  const childCount = Number(children.rows[0]?.cnt) || 0;
  if (childCount > 0) {
    throw new LocationDeleteBlockedError(
      `Нельзя удалить ячейку: у неё ${childCount} дочерних ячеек. Сначала удалите или перенесите их.`
    );
  }
}
