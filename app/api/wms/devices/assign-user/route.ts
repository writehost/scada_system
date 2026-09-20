import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { assignWmsDeviceUser } from "@/lib/wms/devices";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  let body: {
    siteCode?: string;
    deviceId?: string;
    assignedUserId?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const assignedUserId =
    typeof body.assignedUserId === "string"
      ? body.assignedUserId.trim()
      : body.assignedUserId ?? null;

  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!deviceId) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const device = await assignWmsDeviceUser(client, siteId, deviceId, assignedUserId);
    return NextResponse.json({ device });
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}
