import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { syncExpiryStickerAlerts } from "@/lib/wms/expiry-alerts-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMissingExpirySchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : "";
  return (
    code === "42703" ||
    code === "42P01" ||
    message.includes("wms_notifications") ||
    message.includes("wms_notification_recipients") ||
    message.includes("ref_key")
  );
}

type SyncResult = Record<string, unknown>;

/**
 * Синхронизация обходит все партии и на каждую пишет уведомления, то есть стоит
 * несколько секунд запросов к базе на заводе. Её дёргает шапка на каждой
 * странице, поэтому результат живёт заданное время, а параллельные вызовы
 * получают один и тот же ответ.
 */
const SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;
const lastSync = new Map<string, { at: number; result: SyncResult }>();
const inFlight = new Map<string, Promise<SyncResult>>();

function shouldForce(url: URL, body: { force?: unknown }): boolean {
  return url.searchParams.get("force") === "1" || body.force === true;
}

/** Синхронизирует уведомления о сроке стикера (330/350/365 дней с эмиссии). */
export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: { siteCode?: string; force?: unknown } = {};
  try {
    body = (await req.json()) as { siteCode?: string; force?: unknown };
  } catch {
    body = {};
  }

  const url = new URL(req.url);
  const siteCode = (body.siteCode ?? url.searchParams.get("siteCode") ?? "").trim();
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const force = shouldForce(url, body);
  const cached = lastSync.get(siteCode);
  if (!force && cached && Date.now() - cached.at < SYNC_MIN_INTERVAL_MS) {
    return NextResponse.json({
      ...cached.result,
      fromCache: true,
      ageMs: Date.now() - cached.at,
    });
  }

  const running = inFlight.get(siteCode);
  if (running) {
    return NextResponse.json({ ...(await running), deduplicated: true });
  }

  const task = (async (): Promise<SyncResult> => {
    const client = await pool.connect();
    try {
      const siteId = await getSiteId(client, siteCode);
      if (siteId == null) return { error: "unknown siteCode", status: 404 };
      const result = (await syncExpiryStickerAlerts(client, siteId)) as SyncResult;
      lastSync.set(siteCode, { at: Date.now(), result });
      return result;
    } catch (error) {
      if (isMissingExpirySchema(error)) {
        const result: SyncResult = {
          synced: 0,
          activeAlerts: 0,
          skipped: true,
          code: "expiry_schema_missing",
          error:
            "expiry notification schema is missing; run patches/2026-05-26_expiry_sticker_alerts.sql",
        };
        lastSync.set(siteCode, { at: Date.now(), result });
        return result;
      }
      throw error;
    } finally {
      client.release();
    }
  })();

  inFlight.set(siteCode, task);
  try {
    const result = await task;
    if (result.status === 404) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    return NextResponse.json(result);
  } finally {
    inFlight.delete(siteCode);
  }
}
