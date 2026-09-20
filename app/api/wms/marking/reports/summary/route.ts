import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { requireWmsActor } from "@/lib/wms/require-actor";
import {
  queryMarkingStatusSummary,
  queryMarkingStorageStats,
} from "@/lib/wms/marking-reports";
import { pingClickHouse } from "@/lib/wms/clickhouse-client";
import { queryMarkingEventsStatsCH } from "@/lib/wms/marking-reports-ch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wms/marking/reports/summary?siteId=1
 */
export async function GET(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }
  const conn = await tryConnect(pool);
  if (!conn.ok) {
    return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status });
  }

  const url = new URL(req.url);
  const siteId = Math.max(0, Number(url.searchParams.get("siteId") ?? "0") || 0);

  try {
    const [byStatus, storage] = await Promise.all([
      queryMarkingStatusSummary(conn.client, siteId),
      queryMarkingStorageStats(conn.client),
    ]);
    const totalCodes = byStatus.reduce((s, r) => s + r.count, 0);

    let clickhouse: { available: boolean; codeEvents?: number } = { available: false };
    if (await pingClickHouse()) {
      const chStats = await queryMarkingEventsStatsCH();
      clickhouse = { available: true, codeEvents: chStats.totalEvents };
    }

    return NextResponse.json({
      siteId,
      totalCodes,
      byStatus,
      storage,
      clickhouse,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[GET /api/wms/marking/reports/summary]", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  } finally {
    conn.client.release();
  }
}
