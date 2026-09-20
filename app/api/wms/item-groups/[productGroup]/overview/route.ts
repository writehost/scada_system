import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeGroup(s: string) {
  const v = decodeURIComponent(s ?? "");
  return v === "—" ? "" : v;
}

export async function GET(
  req: Request,
  segmentData: { params: Promise<{ productGroup: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  const params = await segmentData.params;
  const productGroup = decodeGroup(params.productGroup);

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const items = await client.query(
      `SELECT
         i.item_code AS "itemCode",
         i.name AS "name",
         i.material_type AS "materialType",
         i.product_group AS "productGroup",
         i.uom_code AS "uomCode",
         EXISTS (
           SELECT 1
           FROM wms_item_specs s
           WHERE s.site_id = i.site_id AND s.parent_item_id = i.item_id AND s.is_active
         ) AS "hasActiveSpec"
       FROM wms_items i
       WHERE i.site_id = $1
         AND ($2::text = '' OR COALESCE(i.product_group, '') = $2)
       ORDER BY i.item_code`,
      [siteId, productGroup]
    );

    const materials = await client.query(
      `WITH parents AS (
         SELECT i.item_id
         FROM wms_items i
         WHERE i.site_id = $1
           AND ($2::text = '' OR COALESCE(i.product_group, '') = $2)
       ),
       active_specs AS (
         SELECT DISTINCT ON (s.parent_item_id)
           s.parent_item_id,
           s.spec_id,
           s.spec_code,
           s.version_no
         FROM wms_item_specs s
         JOIN parents p ON p.item_id = s.parent_item_id
         WHERE s.site_id = $1 AND s.is_active
         ORDER BY s.parent_item_id, s.version_no DESC
       )
       SELECT
         c.item_code AS "itemCode",
         c.name AS "name",
         c.material_type AS "materialType",
         c.product_group AS "productGroup",
         sc.component_role_code AS "componentRoleCode",
         sc.uom_code AS "uomCode",
         COUNT(DISTINCT s.parent_item_id)::int AS "usedInCount",
         COALESCE(SUM(sc.qty_per), 0)::float8 AS "qtyPerSum"
       FROM active_specs s
       JOIN wms_item_spec_components sc ON sc.spec_id = s.spec_id
       JOIN wms_items c ON c.item_id = sc.component_item_id
       GROUP BY c.item_id, sc.component_role_code, sc.uom_code
       ORDER BY "usedInCount" DESC, c.item_code`,
      [siteId, productGroup]
    );

    return NextResponse.json({ items: items.rows, materials: materials.rows });
  } finally {
    client.release();
  }
}

