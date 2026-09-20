import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { resolveMarkingReportsSource } from "@/lib/wms/clickhouse-client";
import { queryMarkingEventsByDay } from "@/lib/wms/marking-reports";
import { queryMarkingEventsByDayCH } from "@/lib/wms/marking-reports-ch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * GET /api/wms/marking/reports/events?siteId=1&from=...&to=...
 * Source: MARKING_REPORTS_SOURCE=auto|postgres|clickhouse
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const siteId = Math.max(0, Number(url.searchParams.get("siteId") ?? "0") || 0);
  const defaults = defaultRange();
  const from = url.searchParams.get("from") ?? defaults.from;
  const to = url.searchParams.get("to") ?? defaults.to;

  let source: "postgresql" | "clickhouse";
  try {
    source = await resolveMarkingReportsSource();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "source resolution failed";
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  try {
    if (source === "clickhouse") {
      const rows = await queryMarkingEventsByDayCH(siteId, from, to);
      const totalEvents = rows.reduce((s, r) => s + r.count, 0);
      return NextResponse.json({
        siteId,
        from,
        to,
        totalEvents,
        rows,
        source: "clickhouse",
        generatedAt: new Date().toISOString(),
      });
    }

    const pool = tryGetPool();
    if (!pool) {
      return NextResponse.json({ error: "database not configured" }, { status: 503 });
    }
    const conn = await tryConnect(pool);
    if (!conn.ok) {
      return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status });
    }
    try {
      const rows = await queryMarkingEventsByDay(conn.client, siteId, from, to);
      const totalEvents = rows.reduce((s, r) => s + r.count, 0);
      return NextResponse.json({
        siteId,
        from,
        to,
        totalEvents,
        rows,
        source: "postgresql",
        generatedAt: new Date().toISOString(),
      });
    } finally {
      conn.client.release();
    }
  } catch (error) {
    console.error("[GET /api/wms/marking/reports/events]", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
