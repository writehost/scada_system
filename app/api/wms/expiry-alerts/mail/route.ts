import { NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/wms/local-request";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { requireWmsSession } from "@/lib/wms/require-session";
import {
  previewExpiryProductMail,
  saveExpiryProductMailSettings,
  sendExpiryProductMailDigest,
} from "@/lib/wms/expiry-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function siteCodeOf(req: Request, body?: { siteCode?: unknown }): string {
  if (typeof body?.siteCode === "string" && body.siteCode.trim()) return body.siteCode.trim();
  return new URL(req.url).searchParams.get("siteCode")?.trim() || "";
}

function isMissingSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : "";
  return (
    code === "42703" ||
    code === "42P01" ||
    message.includes("wms_stock_lots") ||
    message.includes("wms_app_settings") ||
    message.includes("wms_sites")
  );
}

export async function GET(req: Request) {
  if (!isLocalRequest(req)) {
    const auth = await requireWmsSession(req);
    if ("error" in auth) return auth.error;
  }

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const siteCode = siteCodeOf(req);
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const { settings, alerts } = await previewExpiryProductMail(client, siteId);
    return NextResponse.json({
      settings,
      previewCount: alerts.length,
      previewAlerts: alerts.slice(0, 20),
    });
  } catch (error) {
    if (isMissingSchema(error)) {
      return NextResponse.json({
        settings: {
          enabled: true,
          recipients: [],
          includeWarning: false,
          includeCritical: true,
          includeExpired: true,
          timeZone: "Asia/Vladivostok",
          sendHour: 8,
          lastSentAt: null,
          lastSentCount: 0,
          lastError: null,
          lastSkipReason: null,
        },
        previewCount: 0,
        previewAlerts: [],
        skipped: true,
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

type MailBody = {
  siteCode?: string;
  action?: string;
  settings?: unknown;
  cron?: unknown;
  force?: unknown;
  dryRun?: unknown;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: MailBody = {};
  try {
    body = (await req.json()) as MailBody;
  } catch {
    body = {};
  }

  const url = new URL(req.url);
  const siteCode = siteCodeOf(req, body);
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

    const action = String(body.action || url.searchParams.get("action") || "send").trim().toLowerCase();
    const cron = body.cron === true || url.searchParams.get("cron") === "1";
    // Cron hits :3004 on loopback. The same call via nginx is from the internet.
    if (cron && !isLocalRequest(req)) {
      return NextResponse.json({ error: "cron send is local-only" }, { status: 403 });
    }
    if (!cron || !isLocalRequest(req)) {
      const auth = await requireWmsSession(req);
      if ("error" in auth) return auth.error;
    }
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    if (action === "save") {
      const settings = await saveExpiryProductMailSettings(client, siteId, body.settings ?? {});
      return NextResponse.json({ settings });
    }

    if (action !== "send") {
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }

    const result = await sendExpiryProductMailDigest(client, siteId, {
      cron: body.cron === true || url.searchParams.get("cron") === "1",
      force: body.force === true || url.searchParams.get("force") === "1",
      dryRun: body.dryRun === true || url.searchParams.get("dryRun") === "1",
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (isMissingSchema(error)) {
      return NextResponse.json(
        { error: "expiry mail schema is missing", skipped: true },
        { status: 503 }
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
