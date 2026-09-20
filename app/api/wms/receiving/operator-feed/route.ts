import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { listDocuments } from "@/lib/wms/documents";
import {
  listLatestReceivingSessionStatusesForSite,
  listReceivingScanAggregatesForSite,
} from "@/lib/wms/code-lists";
import {
  listReceivingScanRowsBySite,
  receivingPostSummariesForSite,
  type ReceivingPostSummary,
  type ReceivingScanRow,
} from "@/lib/wms/receiving-finalize";
import {
  latestIso,
  normalizeTsdDocumentId,
  pickNewerTsdSessionStatus,
  type TsdSessionRow,
} from "@/lib/wms/receiving-tsd-sessions";
import {
  isReceivingScanPostable,
  receivingScanGateFromRow,
  type ReceivingSiteRules,
} from "@/lib/receiving-scan-policy";
import { getReceivingInbound, loadReceivingSiteRules } from "@/lib/wms/receiving-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Лента опрашивается несколькими вкладками каждые несколько секунд — держим общий короткий кэш. */
const FEED_TTL_MS = 2_500;
const feedCache = new Map<string, { at: number; payload: unknown }>();
const feedInFlight = new Map<string, Promise<unknown>>();

type ScanEventRow = {
  id: string;
  createdAt: string;
  deviceUid: string | null;
  code: string;
  documentId: string | null;
  scannedAtIso: string | null;
  itemCode: string | null;
  itemName: string | null;
  qty: number | null;
  note: string | null;
  stickerStatus: string | null;
  itemStatus: string | null;
  emissionAtIso: string | null;
  expiryState: string | null;
};

/**
 * События сканирования постранично и уже отсортированные базой.
 * Раньше маршрут вытаскивал entries_json целых списков (до 7000 сканов в одном) и резал их в JS.
 */
async function listScanEvents(
  client: PoolClient,
  siteId: number,
  opts: { documentId: string | null; limit: number; offset: number }
): Promise<{ rows: ScanEventRow[]; total: number }> {
  const params: unknown[] = [siteId];
  let docFilter = "";
  if (opts.documentId) {
    params.push(opts.documentId);
    docFilter = ` AND upper(trim(COALESCE(e.value->>'documentId', ''))) = $${params.length}`;
  }
  const limitIdx = params.push(opts.limit);
  const offsetIdx = params.push(opts.offset);
  const r = await client.query<ScanEventRow & { total: string }>(
    `WITH events AS (
       SELECT
         cl.code_list_id::text || ':' || e.idx::text AS id,
         cl.created_at AS "createdAt",
         cl.device_uid AS "deviceUid",
         trim(COALESCE(e.value->>'code', '')) AS code,
         upper(trim(COALESCE(e.value->>'documentId', ''))) AS "documentId",
         NULLIF(trim(COALESCE(e.value->>'scannedAtIso', '')), '') AS "scannedAtIso",
         NULLIF(trim(COALESCE(e.value->>'itemCode', '')), '') AS "itemCode",
         NULLIF(trim(COALESCE(e.value->>'itemName', '')), '') AS "itemName",
         e.value->>'qty' AS qty,
         NULLIF(trim(COALESCE(e.value->>'note', '')), '') AS note,
         NULLIF(trim(COALESCE(e.value->>'stickerStatus', '')), '') AS "stickerStatus",
         NULLIF(trim(COALESCE(e.value->>'itemStatus', '')), '') AS "itemStatus",
         NULLIF(trim(COALESCE(e.value->>'emissionAtIso', '')), '') AS "emissionAtIso",
         NULLIF(trim(COALESCE(e.value->>'expiryState', '')), '') AS "expiryState",
         CASE
           WHEN trim(COALESCE(e.value->>'scannedAtIso', '')) ~ '^\\d{4}-\\d{2}-\\d{2}'
             THEN (e.value->>'scannedAtIso')::timestamptz
           ELSE cl.created_at
         END AS sort_at
       FROM wms_code_lists cl
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json ELSE '[]'::jsonb END
       ) WITH ORDINALITY AS e(value, idx)
       WHERE cl.site_id = $1
         AND cl.list_type = 'receiving_scan_event'
         AND NULLIF(trim(COALESCE(e.value->>'code', '')), '') IS NOT NULL${docFilter}
     )
     SELECT *, count(*) OVER ()::text AS total
     FROM events
     ORDER BY sort_at DESC, id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  const total = Number(r.rows[0]?.total ?? 0);
  return {
    rows: r.rows.map((row) => ({
      id: row.id,
      createdAt: String(row.createdAt ?? ""),
      deviceUid: row.deviceUid,
      code: row.code,
      documentId: row.documentId || null,
      scannedAtIso: row.scannedAtIso,
      itemCode: row.itemCode,
      itemName: row.itemName,
      qty: Number.isFinite(Number(row.qty)) ? Number(row.qty) : null,
      note: row.note,
      stickerStatus: row.stickerStatus,
      itemStatus: row.itemStatus,
      emissionAtIso: row.emissionAtIso,
      expiryState: row.expiryState,
    })),
    total: Number.isFinite(total) ? total : r.rows.length,
  };
}

async function listMissingNomenclature(client: PoolClient, siteId: number, limit: number) {
  const r = await client.query<{
    id: string;
    createdAt: string;
    deviceUid: string | null;
    code: string;
    note: string | null;
    comment: string | null;
    resolvedAction: string | null;
    resolvedItemCode: string | null;
  }>(
    `SELECT
       cl.code_list_id::text AS id,
       cl.created_at AS "createdAt",
       cl.device_uid AS "deviceUid",
       trim(COALESCE(cl.entries_json->0->>'code', '')) AS code,
       NULLIF(trim(COALESCE(cl.entries_json->0->>'note', '')), '') AS note,
       NULLIF(trim(COALESCE(cl.entries_json->0->>'comment', '')), '') AS comment,
       NULLIF(trim(COALESCE(cl.entries_json->0->>'resolvedAction', '')), '') AS "resolvedAction",
       NULLIF(trim(COALESCE(cl.entries_json->0->>'resolvedItemCode', '')), '') AS "resolvedItemCode"
     FROM wms_code_lists cl
     WHERE cl.site_id = $1
       AND cl.list_type = 'missing_nomenclature'
       AND NULLIF(trim(COALESCE(cl.entries_json->0->>'code', '')), '') IS NOT NULL
       AND COALESCE(cl.entries_json->0->>'resolvedAction', '') NOT IN ('bind', 'create')
     ORDER BY cl.created_at DESC, cl.code_list_id DESC
     LIMIT $2`,
    [siteId, limit]
  );
  return r.rows.map((row) => ({
    id: row.id,
    createdAt: String(row.createdAt ?? ""),
    deviceUid: row.deviceUid,
    code: row.code,
    note: row.note || "Отсутствует номенклатура, нужно добавить позже",
    comment: row.comment,
    resolvedAction: row.resolvedAction,
    resolvedItemCode: row.resolvedItemCode,
  }));
}

/** Первый и последний скан сессии — чтобы карточка показывала, когда её начали и когда трогали. */
async function sessionTimeline(client: PoolClient, siteId: number, documentId: string) {
  const r = await client.query<{ firstAt: string | null; lastAt: string | null; devices: string[] }>(
    `SELECT
       min(CASE
             WHEN trim(COALESCE(e->>'scannedAtIso', '')) ~ '^\\d{4}-\\d{2}-\\d{2}'
               THEN (e->>'scannedAtIso')::timestamptz
             ELSE cl.created_at
           END)::text AS "firstAt",
       max(CASE
             WHEN trim(COALESCE(e->>'scannedAtIso', '')) ~ '^\\d{4}-\\d{2}-\\d{2}'
               THEN (e->>'scannedAtIso')::timestamptz
             ELSE cl.created_at
           END)::text AS "lastAt",
       COALESCE(array_agg(DISTINCT cl.device_uid) FILTER (WHERE cl.device_uid IS NOT NULL), '{}') AS devices
     FROM wms_code_lists cl
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json ELSE '[]'::jsonb END
     ) AS e
     WHERE cl.site_id = $1
       AND cl.list_type IN ('receiving_scan_event', 'receiving_session_status')
       AND upper(trim(COALESCE(e->>'documentId', e->>'code', ''))) = $2`,
    [siteId, documentId]
  );
  const row = r.rows[0];
  return {
    firstAtIso: row?.firstAt ?? null,
    lastAtIso: row?.lastAt ?? null,
    devices: Array.isArray(row?.devices) ? row!.devices.filter(Boolean) : [],
  };
}

function isAllowedScan(
  scan: ReceivingScanRow,
  rules?: ReceivingSiteRules,
  productGroup?: string | null
): boolean {
  return isReceivingScanPostable(receivingScanGateFromRow(scan, rules, productGroup), false);
}

/** Позиции сессии: что именно принято, в каком количестве и сколько из этого проблемное. */
function sessionLines(
  scans: ReceivingScanRow[],
  rules?: ReceivingSiteRules,
  productGroup?: string | null
) {
  const map = new Map<
    string,
    {
      itemCode: string;
      itemName: string | null;
      qty: number;
      scanCount: number;
      okCount: number;
      blockedCount: number;
      expiredCount: number;
      firstEmissionAtIso: string | null;
      lastEmissionAtIso: string | null;
    }
  >();
  for (const scan of scans) {
    const itemCode = (scan.itemCode ?? "").trim() || "—";
    const row =
      map.get(itemCode) ??
      {
        itemCode,
        itemName: scan.itemName,
        qty: 0,
        scanCount: 0,
        okCount: 0,
        blockedCount: 0,
        expiredCount: 0,
        firstEmissionAtIso: null,
        lastEmissionAtIso: null,
      };
    row.itemName = row.itemName ?? scan.itemName;
    row.qty += scan.qty;
    row.scanCount += 1;
    const expired = scan.expiryState === "expired" || scan.itemStatus === "просрочен";
    if (expired) row.expiredCount += 1;
    if (isAllowedScan(scan, rules, productGroup)) row.okCount += 1;
    else row.blockedCount += 1;
    if (scan.emissionAtIso) {
      if (!row.firstEmissionAtIso || scan.emissionAtIso < row.firstEmissionAtIso) {
        row.firstEmissionAtIso = scan.emissionAtIso;
      }
      if (!row.lastEmissionAtIso || scan.emissionAtIso > row.lastEmissionAtIso) {
        row.lastEmissionAtIso = scan.emissionAtIso;
      }
    }
    map.set(itemCode, row);
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty);
}

async function buildFeed(
  client: PoolClient,
  siteId: number,
  opts: { limit: number; documentId: string; scanLimit: number; scanOffset: number }
) {
  const requestedDocumentId = opts.documentId;
  const rules = await loadReceivingSiteRules(client, siteId);

  const docs = await listDocuments(client, siteId, {
    limit: opts.limit,
    documentType: "receiving",
  });
  const latestSessions = await listLatestReceivingSessionStatusesForSite(client, siteId, {
    maxDocuments: 800,
  });
  const scanAggregates = await listReceivingScanAggregatesForSite(client, siteId);
  const scansByDocument = await listReceivingScanRowsBySite(client, siteId);
  const summaries = await receivingPostSummariesForSite(client, siteId, { scansByDocument });
  const events = await listScanEvents(client, siteId, {
    documentId: requestedDocumentId || null,
    limit: opts.scanLimit,
    offset: opts.scanOffset,
  });
  const missingNomenclature = requestedDocumentId
    ? []
    : await listMissingNomenclature(client, siteId, opts.limit);

  const sessionMap = new Map<string, TsdSessionRow>();

  for (const row of latestSessions.sessions as Array<{
    documentId: string;
    status: string;
    lineCount: number | null;
    updatedAtIso: string | null;
    deviceUid: string | null;
    productGroup?: string | null;
    itemName?: string | null;
  }>) {
    const documentId = normalizeTsdDocumentId(String(row.documentId ?? ""));
    if (!documentId) continue;
    const next: TsdSessionRow = {
      documentId,
      status: String(row.status ?? "").trim().toLowerCase() || "active",
      lineCount: Number.isFinite(Number(row.lineCount)) ? Number(row.lineCount) : null,
      updatedAtIso: row.updatedAtIso ? String(row.updatedAtIso) : null,
      deviceUid: row.deviceUid ? String(row.deviceUid) : null,
      productGroup: row.productGroup ? String(row.productGroup) : null,
      itemName: row.itemName ? String(row.itemName) : null,
    };
    const prev = sessionMap.get(documentId);
    sessionMap.set(documentId, prev ? pickNewerTsdSessionStatus(prev, next) : next);
  }

  for (const agg of scanAggregates) {
    const documentId = normalizeTsdDocumentId(agg.documentId);
    if (!documentId) continue;
    const prev = sessionMap.get(documentId);
    const lineCount = Math.max(Number(prev?.lineCount) || 0, Number(agg.lineCount) || 0);
    sessionMap.set(documentId, {
      documentId,
      status: prev?.status || "active",
      lineCount,
      updatedAtIso: prev?.updatedAtIso ?? null,
      deviceUid: prev?.deviceUid ?? null,
      productGroup: prev?.productGroup ?? null,
      itemName: prev?.itemName || agg.itemName,
      itemCode: agg.itemCode,
      totalQty: Number(agg.totalQty) || lineCount,
      scanCount: Number(agg.lineCount) || 0,
      allowedCount: Number(agg.allowedCount) || 0,
      blockedCount: Number(agg.blockedCount) || 0,
    });
  }

  for (const [documentId, summary] of summaries) {
    if (sessionMap.has(documentId)) continue;
    if (summary.lineCount === 0 && !summary.hasPost) continue;
    sessionMap.set(documentId, {
      documentId,
      status: "unknown",
      lineCount: summary.lineCount,
      updatedAtIso: summary.postedAtIso,
      deviceUid: null,
      totalQty: summary.totalQty,
    });
  }

  const withSummary = (s: TsdSessionRow) => {
    const summary: ReceivingPostSummary | undefined = summaries.get(s.documentId);
    return {
      ...s,
      updatedAtIso: latestIso(s.updatedAtIso, summary?.postedAtIso ?? null),
      stockPosted: Boolean(summary?.fullyPosted),
      stockPartiallyPosted: Boolean(summary?.hasPost && !summary.fullyPosted),
      stockPostedAtIso: summary?.postedAtIso ?? null,
      stockLocationCode: summary?.locationCode ?? null,
      stockPostedQty: summary?.postedQty ?? null,
      stockDismissedEmpty: Boolean(summary?.dismissedEmpty),
      stockPendingLineCount: summary?.pendingLineCount ?? 0,
    };
  };

  const tsdSessions = Array.from(sessionMap.values())
    .map(withSummary)
    .map((s) => {
      const scans = scansByDocument.get(s.documentId) ?? [];
      if (scans.length === 0) return s;
      const allowedCount = scans.filter((sc) => isAllowedScan(sc, rules, s.productGroup)).length;
      return { ...s, allowedCount, blockedCount: scans.length - allowedCount };
    })
    .sort((a, b) => Date.parse(b.updatedAtIso || "") - Date.parse(a.updatedAtIso || ""));

  let session: Record<string, unknown> | null = null;
  if (requestedDocumentId) {
    const scans = scansByDocument.get(requestedDocumentId) ?? [];
    const meta = tsdSessions.find((s) => s.documentId === requestedDocumentId) ?? null;
    const summary = summaries.get(requestedDocumentId);
    const timeline = await sessionTimeline(client, siteId, requestedDocumentId);
    const inbound = await getReceivingInbound(client, siteId, requestedDocumentId);
    const productGroup = meta?.productGroup ?? null;
    const rawLines = sessionLines(scans, rules, productGroup);
    const inboundByItem = new Map(
      (inbound?.lines ?? []).map((line) => [line.itemCode.trim().toUpperCase(), line])
    );
    const lines = rawLines.map((line) => {
      const plan = inboundByItem.get(line.itemCode.trim().toUpperCase());
      const expectedQty = plan?.expectedQty ?? 0;
      return {
        ...line,
        expectedQty,
        varianceQty: expectedQty > 0 ? line.qty - expectedQty : 0,
        targetLocationCode: plan?.targetLocationCode ?? "",
        expectedLotCode: plan?.lotCode ?? "",
        splits: plan?.splits ?? [],
      };
    });
    session = {
      documentId: requestedDocumentId,
      status: meta?.status ?? "unknown",
      known: Boolean(meta) || scans.length > 0 || Boolean(summary?.hasPost),
      deviceUid: meta?.deviceUid ?? timeline.devices[0] ?? null,
      devices: timeline.devices,
      productGroup,
      openedAtIso: timeline.firstAtIso,
      updatedAtIso: latestIso(meta?.updatedAtIso ?? null, timeline.lastAtIso),
      scanCount: scans.length,
      scanTotal: events.total,
      totalQty: scans.reduce((sum, s) => sum + s.qty, 0),
      okCount: scans.filter((s) => isAllowedScan(s, rules, productGroup)).length,
      blockedCount: scans.filter((s) => !isAllowedScan(s, rules, productGroup)).length,
      expiredCount: scans.filter(
        (s) => s.expiryState === "expired" || s.itemStatus === "просрочен"
      ).length,
      lines,
      postedLineCount: summary ? summary.lineCount - summary.pendingLineCount : 0,
      pendingLineCount: summary?.pendingLineCount ?? 0,
      postedQty: summary?.postedQty ?? 0,
      stockPosted: Boolean(summary?.fullyPosted),
      stockPartiallyPosted: Boolean(summary?.hasPost && !summary.fullyPosted),
      stockPostedAtIso: summary?.postedAtIso ?? null,
      stockLocationCode: summary?.locationCode ?? null,
      stockDismissedEmpty: Boolean(summary?.dismissedEmpty),
      inbound,
    };
  }

  return {
    documents: docs.documents,
    scanEvents: events.rows,
    scanEventsTotal: events.total,
    scanEventsOffset: opts.scanOffset,
    missingNomenclature,
    receivingRules: rules,
    tsdSessions: requestedDocumentId
      ? tsdSessions.filter((s) => s.documentId === requestedDocumentId)
      : tsdSessions.slice(0, opts.limit),
    session,
    generatedAt: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const requestedDocumentId = normalizeTsdDocumentId(url.searchParams.get("documentId") ?? "");
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? "100"), 300));
  const scanLimit = Math.max(
    1,
    Math.min(Number(url.searchParams.get("scanLimit") ?? (requestedDocumentId ? 200 : limit)), 1000)
  );
  const scanOffset = Math.max(0, Number(url.searchParams.get("scanOffset") ?? "0") || 0);
  const noCache = url.searchParams.get("fresh") === "1";

  const cacheKey = `${siteCode}|${limit}|${requestedDocumentId}|${scanLimit}|${scanOffset}`;
  const cached = feedCache.get(cacheKey);
  if (!noCache && cached && Date.now() - cached.at < FEED_TTL_MS) {
    return NextResponse.json(cached.payload);
  }
  const running = feedInFlight.get(cacheKey);
  if (running) {
    return NextResponse.json(await running);
  }

  const task = (async () => {
    const client = await pool.connect();
    try {
      const siteId = await getSiteId(client, siteCode);
      if (siteId == null) throw new Error("unknown siteCode");
      const payload = await buildFeed(client, siteId, {
        limit,
        documentId: requestedDocumentId,
        scanLimit,
        scanOffset,
      });
      feedCache.set(cacheKey, { at: Date.now(), payload });
      if (feedCache.size > 64) {
        for (const [key, value] of feedCache) {
          if (Date.now() - value.at > 60_000) feedCache.delete(key);
        }
      }
      return payload;
    } finally {
      client.release();
    }
  })();

  feedInFlight.set(cacheKey, task);
  try {
    return NextResponse.json(await task);
  } catch (e) {
    const message = e instanceof Error ? e.message : "feed failed";
    return NextResponse.json(
      { error: message },
      { status: message === "unknown siteCode" ? 404 : 500 }
    );
  } finally {
    feedInFlight.delete(cacheKey);
  }
}
