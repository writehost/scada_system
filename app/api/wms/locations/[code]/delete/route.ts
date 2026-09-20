import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId, resolveLocation } from "@/lib/wms/resolve";
import { requireWmsActor } from "@/lib/wms/require-actor";
import {
  assertLocationDeletable,
  LocationDeleteBlockedError,
  purgeLocationsByIds,
} from "@/lib/wms/location-purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeleteBody = { siteCode?: string };

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
  const locationCode = decodeURIComponent(params.code ?? "").trim();
  if (!locationCode) {
    return NextResponse.json({ error: "location code is required" }, { status: 400 });
  }

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const loc = await resolveLocation(client, siteId, locationCode);
    if (!loc) {
      return NextResponse.json({ error: "location not found" }, { status: 404 });
    }

    const locationId = String(loc.location_id);
    await assertLocationDeletable(client, siteId, locationId);

    await client.query("BEGIN");
    const deletedCodes = await purgeLocationsByIds(client, siteId, [locationId]);
    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      locationCode: deletedCodes[0] ?? locationCode,
      deleted: deletedCodes.length,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof LocationDeleteBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[POST /api/wms/locations/[code]/delete]", error);
    const message = error instanceof Error ? error.message : "internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
