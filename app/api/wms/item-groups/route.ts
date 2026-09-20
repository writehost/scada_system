import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const itemTypeCode = url.searchParams.get("itemTypeCode") ?? "";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const conn = await tryConnect(pool);
  if (!conn.ok) {
    return NextResponse.json(
      { error: conn.message, code: conn.code },
      { status: conn.status }
    );
  }

  const client = conn.client;
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    try {
      const r = await client.query(
        `SELECT
           COALESCE(NULLIF(TRIM(i.product_group), ''), '—') AS "productGroup",
           COUNT(*)::int AS "itemCount",
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1
             FROM wms_item_specs s
             WHERE s.site_id = i.site_id AND s.parent_item_id = i.item_id AND s.is_active
           ))::int AS "withActiveSpecCount",
           MAX(ig.description) AS "groupDescription"
         FROM wms_items i
         LEFT JOIN LATERAL (
           SELECT g.description
           FROM wms_item_groups g
           WHERE g.site_id = i.site_id
             AND g.is_active
             AND NULLIF(TRIM(COALESCE(i.product_group, '')), '') IS NOT NULL
             AND (
               g.group_code = TRIM(i.product_group)
               OR TRIM(g.name) = TRIM(i.product_group)
             )
           ORDER BY g.sort_order, g.group_code
           LIMIT 1
         ) ig ON TRUE
         WHERE i.site_id = $1
           AND (
             $2::text = ''
             OR COALESCE(i.item_type_code, '') = ANY(string_to_array($2, ','))
           )
         GROUP BY COALESCE(NULLIF(TRIM(i.product_group), ''), '—')
         ORDER BY "itemCount" DESC, "productGroup"`,
        [siteId, itemTypeCode.trim()]
      );
      return NextResponse.json({ groups: r.rows });
    } catch (e) {
      const err = e as { code?: string };
      const pgCode = typeof err?.code === "string" ? err.code : "";
      // Совместимость со старыми БД (нет wms_item_groups / новых колонок): отдаём группы только из wms_items.
      if (pgCode === "42P01" || pgCode === "42703") {
        const fallback = await client.query(
          `SELECT
             COALESCE(NULLIF(TRIM(i.product_group), ''), '—') AS "productGroup",
             COUNT(*)::int AS "itemCount",
             0::int AS "withActiveSpecCount",
             NULL::text AS "groupDescription"
           FROM wms_items i
           WHERE i.site_id = $1
             AND (
               $2::text = ''
               OR COALESCE(i.item_type_code, '') = ANY(string_to_array($2, ','))
             )
           GROUP BY COALESCE(NULLIF(TRIM(i.product_group), ''), '—')
           ORDER BY "itemCount" DESC, "productGroup"`,
          [siteId, itemTypeCode.trim()]
        );
        return NextResponse.json({ groups: fallback.rows });
      }
      return NextResponse.json(
        {
          error: wmsDbErrorToUserMessage(e),
          code: "db_query_failed",
        },
        { status: 500 }
      );
    }
  } finally {
    client.release();
  }
}

