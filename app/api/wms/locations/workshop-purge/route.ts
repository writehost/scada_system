import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { purgeLocationsByIds } from "@/lib/wms/location-purge";
import { workshopLocationWhere } from "@/lib/wms/workshop-directory";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: { siteCode?: unknown; confirm?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = cleanText(body.siteCode);
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (body.confirm !== true && body.confirm !== "true") {
    return NextResponse.json({ error: "confirm=true is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    await client.query("BEGIN");

    const ids = await client.query<{ locationId: string }>(
      `SELECT l.location_id::text AS "locationId"
       FROM wms_locations l
       JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
       JOIN wms_zones z ON z.zone_id = l.zone_id
       WHERE l.site_id = $1
         AND ${workshopLocationWhere("w", "z")}`,
      [siteId]
    );

    const locationIds = ids.rows.map((r) => r.locationId);
    if (locationIds.length === 0) {
      await client.query("COMMIT");
      return NextResponse.json({ deleted: 0, locationCodes: [] });
    }

    const locationCodes = await purgeLocationsByIds(client, siteId, locationIds);
    await client.query("COMMIT");

    return NextResponse.json({
      deleted: locationCodes.length,
      locationCodes,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[POST /api/wms/locations/workshop-purge]", error);
    const message = error instanceof Error ? error.message : "internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
