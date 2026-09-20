import { NextResponse } from "next/server";
import { getSiteId, resolveLocation } from "@/lib/wms/resolve";
import { tryGetPool } from "@/lib/wms/pool";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { parseRequestId } from "@/lib/wms/uuid";
import { WmsHttpError } from "@/lib/wms/errors";
import type { PoolClient } from "pg";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  segmentData: { params: Promise<{ code: string }> }
) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const params = await segmentData.params;
  const locationCode = decodeURIComponent(params.code ?? "");

  let body: { requestId?: string; siteCode?: string; blocked?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(body.requestId);
  const siteCode = typeof body.siteCode === "string" ? body.siteCode : "";
  const blocked = Boolean(body.blocked);

  if (!requestId) {
    return NextResponse.json({ error: "requestId must be a UUID" }, { status: 400 });
  }
  if (!siteCode.trim() || !locationCode.trim()) {
    return NextResponse.json(
      { error: "siteCode and location path are required" },
      { status: 400 }
    );
  }

  const probe = await pool.connect();
  let siteId: number;
  try {
    const sid = await getSiteId(probe, siteCode);
    if (sid == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    siteId = sid;
  } finally {
    probe.release();
  }

  try {
    const result = await runIdempotentWrite(
      pool,
      requestId,
      siteId,
      "location_block",
      { ...body, locationCode },
      (client) => blockWork(client, siteId, locationCode, blocked)
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json(
        { error: e.message, code: e.code, disposition: "failed" },
        { status: e.status }
      );
    }
    console.error(e);
    return NextResponse.json(
      { error: "internal error", disposition: "failed" },
      { status: 500 }
    );
  }
}

async function blockWork(
  client: PoolClient,
  siteId: number,
  locationCode: string,
  blocked: boolean
) {
  const loc = await resolveLocation(client, siteId, locationCode);
  if (!loc) {
    throw new WmsHttpError(404, "location not found", "location_not_found");
  }
  const statusId = blocked ? 2 : 1;
  await client.query(
    `UPDATE wms_locations SET location_status_id = $1, updated_at = now()
     WHERE site_id = $2 AND location_id = $3::bigint`,
    [statusId, siteId, loc.location_id]
  );

  const row = await client.query(
    `SELECT
       l.location_code AS "locationCode",
       rls.code AS "locationStatus"
     FROM wms_locations l
     JOIN ref_wms_location_status rls ON rls.location_status_id = l.location_status_id
     WHERE l.site_id = $1 AND l.location_id = $2::bigint`,
    [siteId, loc.location_id]
  );

  return { location: row.rows[0] };
}
