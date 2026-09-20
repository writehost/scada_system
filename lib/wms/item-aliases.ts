import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";

export type WmsItemAliasInput = {
  itemCode: string;
  supplierCode?: string | null;
  supplierName?: string | null;
  aliasName: string;
  aliasSku?: string | null;
  gtin?: string | null;
  source?: string | null;
  createdByUserId?: string | null;
};

export async function listItemAliases(client: PoolClient, siteId: number, itemCode: string) {
  const res = await client.query(
    `
    SELECT
      a.alias_id::text AS "aliasId",
      i.item_code AS "itemCode",
      a.supplier_code AS "supplierCode",
      a.supplier_name AS "supplierName",
      a.alias_name AS "aliasName",
      a.alias_sku AS "aliasSku",
      a.gtin,
      a.source,
      a.confidence::float AS confidence,
      a.is_active AS "isActive",
      a.created_at AS "createdAt",
      a.updated_at AS "updatedAt"
    FROM wms_item_aliases a
    JOIN wms_items i ON i.item_id = a.item_id
    WHERE a.site_id = $1 AND i.item_code = $2
    ORDER BY a.is_active DESC, a.updated_at DESC, a.alias_id DESC
    `,
    [siteId, itemCode]
  );
  return res.rows;
}

export async function createItemAlias(client: PoolClient, siteId: number, input: WmsItemAliasInput) {
  const itemCode = input.itemCode.trim();
  const aliasName = input.aliasName.trim();
  if (!itemCode) throw new WmsHttpError(400, "itemCode is required", "bad_item_code");
  if (!aliasName) throw new WmsHttpError(400, "aliasName is required", "bad_alias_name");

  const item = await client.query<{ itemId: string }>(
    `SELECT item_id::text AS "itemId" FROM wms_items WHERE site_id = $1 AND item_code = $2`,
    [siteId, itemCode]
  );
  const itemId = item.rows[0]?.itemId;
  if (!itemId) throw new WmsHttpError(404, "item not found", "item_not_found");

  const res = await client.query(
    `
    INSERT INTO wms_item_aliases (
      site_id, item_id, supplier_code, supplier_name, alias_name, alias_sku, gtin, source, created_by_user_id
    )
    VALUES ($1, $2::bigint, NULLIF($3, ''), NULLIF($4, ''), $5, NULLIF($6, ''), NULLIF($7, ''), $8, NULLIF($9, '')::bigint)
    ON CONFLICT DO NOTHING
    RETURNING alias_id::text AS "aliasId"
    `,
    [
      siteId,
      itemId,
      input.supplierCode?.trim() ?? "",
      input.supplierName?.trim() ?? "",
      aliasName,
      input.aliasSku?.trim() ?? "",
      input.gtin?.trim() ?? "",
      input.source?.trim() || "manual",
      input.createdByUserId?.trim() ?? "",
    ]
  );

  if (!res.rows[0]) {
    const existing = await client.query<{ aliasId: string }>(
      `
      SELECT a.alias_id::text AS "aliasId"
      FROM wms_item_aliases a
      JOIN wms_items i ON i.item_id = a.item_id AND i.site_id = a.site_id
      WHERE a.site_id = $1
        AND i.item_code = $2
        AND a.is_active
        AND lower(a.alias_name) = lower($3)
        AND COALESCE(lower(a.supplier_code), '') = COALESCE(lower(NULLIF($4, '')), '')
      LIMIT 1
      `,
      [siteId, itemCode, aliasName, input.supplierCode?.trim() ?? ""]
    );
    if (existing.rows[0]) return existing.rows[0];
    throw new WmsHttpError(409, "active alias already exists for supplier", "duplicate_alias");
  }
  return res.rows[0];
}
