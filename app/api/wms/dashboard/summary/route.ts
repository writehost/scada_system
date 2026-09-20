import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Всё, что дашборд показывает про склад, одним запросом к базе.
 * Раньше страница тянула списки документов и заданий целиком (до 2 с через туннель)
 * и всё равно считала итоги в браузере — здесь агрегаты считает PostgreSQL.
 */
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; payload: DashboardSummary }>();
const inFlight = new Map<string, Promise<DashboardSummary>>();

const SUMMARY_SQL = `
WITH zone_stock AS (
  SELECT location_id, SUM(available_qty) AS sumq
  FROM wms_stock_balances
  WHERE site_id = $1
  GROUP BY location_id
),
zones AS (
  SELECT
    w.warehouse_code AS "warehouseCode",
    z.zone_code AS "zoneCode",
    COUNT(*)::int AS "locationCount",
    SUM(CASE WHEN COALESCE(s.sumq, 0) > 0 THEN 1 ELSE 0 END)::int AS "nonEmptyCount",
    COALESCE(SUM(s.sumq), 0)::float8 AS "qty"
  FROM wms_locations l
  JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
  JOIN wms_zones z ON z.zone_id = l.zone_id
  LEFT JOIN zone_stock s ON s.location_id = l.location_id
  WHERE l.site_id = $1
  GROUP BY 1, 2
),
sku AS (
  SELECT
    COUNT(DISTINCT item_id)::int AS "skuCount",
    COALESCE(SUM(available_qty), 0)::float8 AS "totalQty"
  FROM wms_stock_balances
  WHERE site_id = $1 AND COALESCE(available_qty, 0) > 0
),
tasks AS (
  SELECT
    COUNT(*)::int AS "open",
    COUNT(*) FILTER (WHERE t.started_at IS NOT NULL OR ts.code ILIKE '%progress%')::int AS "inProgress",
    COUNT(*) FILTER (WHERE t.due_at IS NOT NULL AND t.due_at < now())::int AS "overdue",
    COUNT(*) FILTER (WHERE t.exception_code IS NOT NULL)::int AS "exceptions"
  FROM wms_tasks t
  JOIN ref_wms_task_status ts ON ts.task_status_id = t.task_status_id
  WHERE t.site_id = $1
    AND t.completed_at IS NULL
    AND ts.code NOT ILIKE '%complete%'
    AND ts.code <> 'cancelled'
),
ops AS (
  SELECT day, kind, SUM(cnt)::int AS cnt
  FROM (
    SELECT
      to_char(d.created_at AT TIME ZONE 'Asia/Vladivostok', 'YYYY-MM-DD') AS day,
      CASE
        WHEN dt.code ILIKE '%receiv%' OR dt.code ILIKE '%receipt%' THEN 'receiving'
        WHEN dt.code ILIKE '%issue%' OR dt.code ILIKE '%ship%' OR dt.code ILIKE '%pick%' THEN 'issue'
        WHEN dt.code ILIKE '%transfer%' OR dt.code ILIKE '%putaway%' OR dt.code ILIKE '%replenish%' THEN 'movement'
        WHEN dt.code ILIKE '%production%' THEN 'production'
        ELSE 'other'
      END AS kind,
      COUNT(*)::int AS cnt
    FROM wms_documents d
    JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
    WHERE d.site_id = $1
      AND d.created_at >= (now() - ($2::int || ' days')::interval)
    GROUP BY 1, 2
    UNION ALL
    -- Выпуски с линии (APS / Векас). Иначе «Производство» = 1–2 списания,
    -- хотя за день уходит 8–13 партий.
    SELECT
      to_char(p.plan_date, 'YYYY-MM-DD') AS day,
      'production' AS kind,
      COUNT(*)::int AS cnt
    FROM wms_production_plans p
    WHERE p.site_id = $1
      AND p.status_code <> 'cancelled'
      AND p.plan_date >= ((now() AT TIME ZONE 'Asia/Vladivostok')::date - ($2::int - 1))
      AND p.plan_date <= (now() AT TIME ZONE 'Asia/Vladivostok')::date
    GROUP BY 1
  ) x
  GROUP BY 1, 2
),
last_ops AS (
  SELECT
    d.document_id::text AS "documentId",
    dt.code AS "documentType",
    ds.code AS "documentStatus",
    d.document_no AS "documentNo",
    NULLIF(trim(COALESCE(d.comment, '')), '') AS comment,
    to_char(d.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS "createdAt",
    (SELECT COUNT(*)::int FROM wms_document_lines dl WHERE dl.document_id = d.document_id) AS "lineCount"
  FROM wms_documents d
  JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
  JOIN ref_wms_document_status ds ON ds.document_status_id = d.document_status_id
  WHERE d.site_id = $1
  ORDER BY d.created_at DESC, d.document_id DESC
  LIMIT 8
),
scan_days AS (
  SELECT
    CASE
      WHEN trim(COALESCE(e.value->>'scannedAtIso', '')) ~ '^\\d{4}-\\d{2}-\\d{2}'
        THEN (e.value->>'scannedAtIso')::timestamptz
      ELSE cl.created_at
    END AS at
  FROM wms_code_lists cl
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS e(value, idx)
  WHERE cl.site_id = $1
    AND cl.list_type = 'receiving_scan_event'
    AND NULLIF(trim(COALESCE(e.value->>'code', '')), '') IS NOT NULL
),
scans AS (
  SELECT
    COUNT(*) FILTER (WHERE at::date = now()::date)::int AS "today",
    COUNT(*) FILTER (WHERE at >= now() - interval '7 days')::int AS "week",
    COUNT(*)::int AS "total",
    to_char(MAX(at), 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS "lastAtIso"
  FROM scan_days
),
scan_series AS (
  SELECT to_char(at AT TIME ZONE 'Asia/Vladivostok', 'YYYY-MM-DD') AS day, COUNT(*)::int AS cnt
  FROM scan_days
  WHERE at >= (now() - ($2::int || ' days')::interval)
  GROUP BY 1
)
SELECT json_build_object(
  'zones', COALESCE((SELECT json_agg(z ORDER BY z."warehouseCode", z."zoneCode") FROM zones z), '[]'::json),
  'sku', (SELECT row_to_json(s) FROM sku s),
  'tasks', (SELECT row_to_json(t) FROM tasks t),
  'ops', COALESCE((SELECT json_agg(o) FROM ops o), '[]'::json),
  'lastOps', COALESCE((SELECT json_agg(l) FROM last_ops l), '[]'::json),
  'scans', (SELECT row_to_json(sc) FROM scans sc),
  'scanSeries', COALESCE((SELECT json_agg(ss) FROM scan_series ss), '[]'::json)
) AS payload
`;

export type DashboardZoneRow = {
  warehouseCode: string;
  zoneCode: string;
  locationCount: number;
  nonEmptyCount: number;
  qty: number;
};

export type DashboardOpsDay = {
  day: string;
  receiving: number;
  movement: number;
  issue: number;
  production: number;
  other: number;
  scans: number;
};

export type DashboardLastOp = {
  documentId: string;
  documentType: string;
  documentStatus: string;
  documentNo: string | null;
  comment: string | null;
  createdAt: string;
  lineCount: number;
};

export type DashboardSummary = {
  siteCode: string;
  generatedAt: string;
  days: number;
  stock: {
    locationCount: number;
    occupiedCount: number;
    emptyCount: number;
    skuCount: number;
    totalQty: number;
    zones: DashboardZoneRow[];
  };
  tasks: { open: number; inProgress: number; overdue: number; exceptions: number };
  operations: {
    series: DashboardOpsDay[];
    totals: { receiving: number; movement: number; issue: number; production: number; other: number };
    today: number;
    week: number;
  };
  scans: { today: number; week: number; total: number; lastAtIso: string | null };
  lastOps: DashboardLastOp[];
};

type RawPayload = {
  zones?: DashboardZoneRow[] | null;
  sku?: { skuCount: number; totalQty: number } | null;
  tasks?: { open: number; inProgress: number; overdue: number; exceptions: number } | null;
  ops?: Array<{ day: string; kind: string; cnt: number }> | null;
  lastOps?: DashboardLastOp[] | null;
  scans?: { today: number; week: number; total: number; lastAtIso: string | null } | null;
  scanSeries?: Array<{ day: string; cnt: number }> | null;
};

const FACTORY_TZ = "Asia/Vladivostok";

function factoryDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FACTORY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDateKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const utc = Date.UTC(y, (m || 1) - 1, (d || 1) + deltaDays);
  const dt = new Date(utc);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Ряд без пропусков: пустые дни тоже нужны, иначе график врёт про темп работы. */
function buildSeries(raw: RawPayload, days: number): DashboardOpsDay[] {
  const byDay = new Map<string, DashboardOpsDay>();
  const todayKey = factoryDateKey();
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = shiftDateKey(todayKey, -i);
    byDay.set(key, {
      day: key,
      receiving: 0,
      movement: 0,
      issue: 0,
      production: 0,
      other: 0,
      scans: 0,
    });
  }
  for (const row of raw.ops ?? []) {
    const bucket = byDay.get(row.day);
    if (!bucket) continue;
    const kind = row.kind as keyof Omit<DashboardOpsDay, "day" | "scans">;
    if (kind in bucket) bucket[kind] += Number(row.cnt) || 0;
  }
  for (const row of raw.scanSeries ?? []) {
    const bucket = byDay.get(row.day);
    if (bucket) bucket.scans += Number(row.cnt) || 0;
  }
  return [...byDay.values()];
}

function shape(raw: RawPayload, siteCode: string, days: number): DashboardSummary {
  const zones = (raw.zones ?? []).map((z) => ({
    warehouseCode: String(z.warehouseCode ?? ""),
    zoneCode: String(z.zoneCode ?? ""),
    locationCount: Number(z.locationCount) || 0,
    nonEmptyCount: Number(z.nonEmptyCount) || 0,
    qty: Number(z.qty) || 0,
  }));
  const locationCount = zones.reduce((sum, z) => sum + z.locationCount, 0);
  const occupiedCount = zones.reduce((sum, z) => sum + z.nonEmptyCount, 0);
  const series = buildSeries(raw, days);
  const totals = series.reduce(
    (acc, day) => ({
      receiving: acc.receiving + day.receiving,
      movement: acc.movement + day.movement,
      issue: acc.issue + day.issue,
      production: acc.production + day.production,
      other: acc.other + day.other,
    }),
    { receiving: 0, movement: 0, issue: 0, production: 0, other: 0 }
  );
  const dayTotal = (d: DashboardOpsDay) => d.receiving + d.movement + d.issue + d.production + d.other;
  const todayKey = factoryDateKey();

  return {
    siteCode,
    generatedAt: new Date().toISOString(),
    days,
    stock: {
      locationCount,
      occupiedCount,
      emptyCount: Math.max(0, locationCount - occupiedCount),
      skuCount: Number(raw.sku?.skuCount) || 0,
      totalQty: Number(raw.sku?.totalQty) || 0,
      zones,
    },
    tasks: {
      open: Number(raw.tasks?.open) || 0,
      inProgress: Number(raw.tasks?.inProgress) || 0,
      overdue: Number(raw.tasks?.overdue) || 0,
      exceptions: Number(raw.tasks?.exceptions) || 0,
    },
    operations: {
      series,
      totals,
      today: dayTotal(series.find((d) => d.day === todayKey) ?? series[series.length - 1] ?? ({} as DashboardOpsDay)),
      week: series.slice(-7).reduce((sum, d) => sum + dayTotal(d), 0),
    },
    scans: {
      today: Number(raw.scans?.today) || 0,
      week: Number(raw.scans?.week) || 0,
      total: Number(raw.scans?.total) || 0,
      lastAtIso: raw.scans?.lastAtIso ?? null,
    },
    lastOps: (raw.lastOps ?? []).map((op) => ({
      documentId: String(op.documentId ?? ""),
      documentType: String(op.documentType ?? ""),
      documentStatus: String(op.documentStatus ?? ""),
      documentNo: op.documentNo ?? null,
      comment: op.comment ?? null,
      createdAt: String(op.createdAt ?? ""),
      lineCount: Number(op.lineCount) || 0,
    })),
  };
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
  const days = Math.max(1, Math.min(Number(url.searchParams.get("days") ?? "30") || 30, 90));
  const fresh = url.searchParams.get("fresh") === "1";
  const key = `${siteCode}|${days}`;

  const cached = cache.get(key);
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json({ ...cached.payload, fromCache: true });
  }
  const running = inFlight.get(key);
  if (running) {
    try {
      return NextResponse.json(await running);
    } catch {
      /* упавший общий запрос не должен ронять этот — считаем заново ниже */
    }
  }

  const task = (async () => {
    const conn = await tryConnect(pool);
    if (conn.ok !== true) {
      const failure = conn as { status: number; code: string; message: string };
      throw Object.assign(new Error(failure.message), { status: failure.status, code: failure.code });
    }
    const client = conn.client;
    try {
      const siteId = await getSiteId(client, siteCode);
      if (siteId == null) throw Object.assign(new Error("unknown siteCode"), { status: 404 });
      const r = await client.query<{ payload: RawPayload }>(SUMMARY_SQL, [siteId, days]);
      const payload = shape(r.rows[0]?.payload ?? {}, siteCode, days);
      cache.set(key, { at: Date.now(), payload });
      return payload;
    } finally {
      client.release();
    }
  })();

  inFlight.set(key, task);
  try {
    return NextResponse.json(await task);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    const message = e instanceof Error ? e.message : "dashboard summary failed";
    return NextResponse.json({ error: message }, { status });
  } finally {
    inFlight.delete(key);
  }
}
