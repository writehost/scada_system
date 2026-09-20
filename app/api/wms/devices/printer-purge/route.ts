import { NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/wms/local-request";
import { tryGetPool } from "@/lib/wms/pool";
import { upsertPrintTerminal } from "@/lib/wms/print-terminal";
import { notifyPrinterCodesPurged } from "@/lib/wms/printer-purge-notify";
import { getSiteId } from "@/lib/wms/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  siteCode?: string;
  deviceId?: string;
  device_id?: string;
  deleted?: unknown;
  retentionDays?: unknown;
  retention_days?: unknown;
  jobs?: unknown;
  appVersion?: string;
  app_version?: string;
  purgedAt?: unknown;
  purged_at?: unknown;
};

export async function POST(req: Request) {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ error: "printer purge notify is local-only" }, { status: 403 });
  }

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const siteCode = String(body.siteCode || "DEFAULT").trim() || "DEFAULT";
  const deviceId = String(body.deviceId || body.device_id || "").trim();
  const deleted = Number(body.deleted);

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    if (deviceId) {
      await upsertPrintTerminal(client, siteId, {
        rawDeviceId: deviceId,
        appVersion: String(body.appVersion || body.app_version || "").trim() || undefined,
      }).catch(() => undefined);
    }
    if (!Number.isFinite(deleted) || deleted <= 0) {
      return NextResponse.json({ ok: true, skipped: "nothing_deleted" });
    }
    const result = await notifyPrinterCodesPurged(client, siteId, {
      deviceId,
      deleted,
      retentionDays: body.retentionDays ?? body.retention_days,
      jobs: body.jobs,
      appVersion: String(body.appVersion || body.app_version || ""),
      purgedAt: body.purgedAt ?? body.purged_at,
    });
    return NextResponse.json({ ok: true, ...result });
  } finally {
    client.release();
  }
}
