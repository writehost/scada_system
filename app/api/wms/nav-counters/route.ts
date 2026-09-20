import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Counters = { receiving: number; movement: number; tasks: number };

/**
 * Счётчики для бокового меню. Раньше меню тянуло два тяжёлых списка по сотне
 * строк (~2 с через туннель к базе), теперь это один запрос со счётчиками,
 * результат живёт минуту на процесс.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Counters }>();

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

  const cached = cache.get(siteCode);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json({ ...cached.value, fromCache: true });
  }

  const conn = await tryConnect(pool);
  if (conn.ok !== true) {
    const failure = conn as { status: number; code: string; message: string };
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status }
    );
  }

  const client = conn.client;
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const r = await client.query<Counters>(
      `SELECT
         (SELECT COUNT(*)
            FROM wms_documents d
            JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
           WHERE d.site_id = $1
             AND (dt.code ILIKE '%receiv%' OR dt.code ILIKE '%receipt%'))::int AS receiving,
         (SELECT COUNT(*)
            FROM wms_tasks t
            JOIN ref_wms_task_type tt ON tt.task_type_id = t.task_type_id
           WHERE t.site_id = $1
             AND (tt.code ILIKE '%move%' OR tt.code ILIKE '%transfer%' OR tt.code ILIKE '%putaway%'))::int AS movement,
         (SELECT COUNT(*)
            FROM wms_tasks t
            JOIN ref_wms_task_status ts ON ts.task_status_id = t.task_status_id
           WHERE t.site_id = $1
             AND t.completed_at IS NULL
             AND ts.code NOT ILIKE '%complete%'
             AND ts.code <> 'cancelled')::int AS tasks`,
      [siteId]
    );

    const value: Counters = {
      receiving: Number(r.rows[0]?.receiving ?? 0),
      movement: Number(r.rows[0]?.movement ?? 0),
      tasks: Number(r.rows[0]?.tasks ?? 0),
    };
    cache.set(siteCode, { at: Date.now(), value });
    return NextResponse.json(value);
  } catch {
    return NextResponse.json({ receiving: 0, movement: 0, tasks: 0, unavailable: true });
  } finally {
    client.release();
  }
}
