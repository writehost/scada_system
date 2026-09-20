import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";

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
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const openOnly = url.searchParams.get("openOnly") !== "false";
    const r = await client.query(
      `SELECT
         c.conflict_id::text AS "conflictId",
         cr.code AS "conflictType",
         c.entity_type AS "entityType",
         c.entity_id AS "entityId",
         c.resolution_note AS "resolutionNote",
         c.created_at AS "createdAt",
         c.resolved_at AS "resolvedAt"
       FROM wms_sync_conflicts c
       JOIN ref_wms_conflict_type cr ON cr.conflict_type_id = c.conflict_type_id
       WHERE c.site_id = $1
         AND ($2::boolean = false OR c.resolved_at IS NULL)
       ORDER BY c.created_at DESC
       LIMIT 200`,
      [siteId, openOnly]
    );
    return NextResponse.json({ conflicts: r.rows });
  } finally {
    client.release();
  }
}
