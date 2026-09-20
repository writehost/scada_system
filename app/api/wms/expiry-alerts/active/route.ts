import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { listExpiryStickerAlerts } from "@/lib/wms/expiry-alerts-sync";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMissingExpirySchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : "";
  return (
    code === "42703" ||
    code === "42P01" ||
    message.includes("wms_stock_lots") ||
    message.includes("wms_notifications") ||
    message.includes("ref_key")
  );
}

export async function GET(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim();
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const alerts = await listExpiryStickerAlerts(client, siteId);
    return NextResponse.json({ alerts });
  } catch (error) {
    if (isMissingExpirySchema(error)) {
      return NextResponse.json({
        alerts: [],
        skipped: true,
        code: "expiry_schema_missing",
        error:
          "expiry alert schema is missing; run patches/2026-05-26_expiry_sticker_alerts.sql",
      });
    }
    throw error;
  } finally {
    client.release();
  }
}
