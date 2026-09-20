import type { PoolClient } from "pg";
import { randomUUID } from "crypto";
import { WmsHttpError } from "@/lib/wms/errors";
import { createCodeList } from "@/lib/wms/code-lists";
import { ensureWmsLot } from "@/lib/wms/documents";
import { resolveItemByCodeOrBarcode, resolveLocation } from "@/lib/wms/resolve";
import { normalizeTsdDocumentId } from "@/lib/wms/receiving-tsd-sessions";
import {
  recommendStorageLocations,
  buildSlotDisplayName,
  buildReceivingCellCreationSuggestion,
  type ItemSlotRequirements,
  type ReceivingMissingCellDetails,
} from "@/lib/wms/storage-slot";
import { applyStockReceipt } from "@/lib/wms/stock-ledger";
import {
  computeCodeExpiry,
  DEFAULT_CODE_SHELF_LIFE_DAYS,
  isStickersReceivingContext,
  sampleCrptLotDates,
} from "@/lib/wms/receiving-crpt";
import { ensurePrintedStickerItem, normalizePrintedGtin } from "@/lib/wms/printed-sticker-item";
import {
  isReceivingScanPostable,
  receivingScanGateFromRow,
  type ReceivingSiteRules,
} from "@/lib/receiving-scan-policy";
import {
  getReceivingInbound,
  loadReceivingSiteRules,
  parseReceivingSplits,
  type ReceivingLineSplit,
} from "@/lib/wms/receiving-rules";

export type ReceivingLineTarget = {
  itemCode: string;
  locationCode: string;
  qty?: number;
  lpnCode?: string;
  lpnKind?: "" | "pallet" | "box";
};

function destinationsForLine(
  line: AggregatedReceivingLine,
  targets: ReceivingLineTarget[],
  inboundSplits: ReceivingLineSplit[],
  fallback?: string
): Array<{ locationCode: string; qty: number; lpnCode: string; lpnKind: string }> {
  const item = line.itemCode.trim().toUpperCase();
  const fromInput = targets.filter(
    (t) => t.itemCode.trim().toUpperCase() === item && t.locationCode.trim()
  );
  const source = (
    fromInput.length > 0
      ? fromInput.map((t) => ({
          locationCode: t.locationCode.trim(),
          qty: Number(t.qty) || 0,
          lpnCode: (t.lpnCode ?? "").trim(),
          lpnKind: t.lpnKind === "pallet" || t.lpnKind === "box" ? t.lpnKind : "",
        }))
      : inboundSplits
  ).filter((s) => s.locationCode);
  if (source.length === 0) {
    return fallback
      ? [{ locationCode: fallback, qty: line.qty, lpnCode: "", lpnKind: "" }]
      : [];
  }
  const assigned = source.filter((s) => s.qty > 0);
  const open = source.filter((s) => s.qty <= 0);
  const out: Array<{ locationCode: string; qty: number; lpnCode: string; lpnKind: string }> = [];
  let remaining = line.qty;
  for (const s of assigned) {
    const q = Math.min(s.qty, remaining);
    if (q <= 0) continue;
    out.push({ ...s, qty: q });
    remaining -= q;
  }
  if (remaining > 1e-9 && open.length > 0) {
    const each = remaining / open.length;
    for (const s of open) out.push({ ...s, qty: each });
    remaining = 0;
  }
  if (remaining > 1e-9) {
    if (out[0]) out[0].qty += remaining;
    else if (fallback) out.push({ locationCode: fallback, qty: remaining, lpnCode: "", lpnKind: "" });
  }
  return out;
}

export type ReceivingScanRow = {
  code: string;
  itemCode: string | null;
  itemName: string | null;
  qty: number;
  stickerStatus: string | null;
  itemStatus: string | null;
  emissionAtIso: string | null;
  expiryState: string | null;
};

export type AggregatedReceivingLine = {
  itemCode: string;
  itemName: string | null;
  emissionDay: string;
  emissionAtIso: string | null;
  qty: number;
  scanCount: number;
  lotCode: string;
};

export type FinalizeReceivingResult = {
  documentId: string;
  locationCode: string;
  alreadyPosted: boolean;
  lines: AggregatedReceivingLine[];
  movementsCreated: number;
  skippedScans: Array<{ code: string; reason: string }>;
  postedAtIso: string | null;
  /** Предупреждение оператору (например, ячейка из настроек не найдена). */
  postingNote?: string | null;
};

export type DismissEmptyReceivingResult = {
  documentId: string;
  alreadyDismissed: boolean;
  dismissedAtIso: string | null;
};

function emissionDayKey(emissionAtIso: string | null): string {
  if (!emissionAtIso?.trim()) return "unknown";
  const d = new Date(emissionAtIso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function buildLotCode(itemCode: string, emissionDay: string): string {
  const safeItem = itemCode.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "ITEM";
  return `RCV-${emissionDay}-${safeItem}`;
}

export async function listReceivingScanEventsForDocument(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<ReceivingScanRow[]> {
  const doc = normalizeTsdDocumentId(documentId);
  const r = await client.query<{ entries: unknown }>(
    `SELECT entries_json AS entries
     FROM wms_code_lists cl
     WHERE cl.site_id = $1
       AND cl.list_type = 'receiving_scan_event'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json ELSE '[]'::jsonb END
         ) e
         WHERE upper(trim(COALESCE(e->>'documentId', ''))) = $2
       )
     ORDER BY cl.created_at DESC, cl.code_list_id DESC`,
    [siteId, doc]
  );
  const rows: ReceivingScanRow[] = [];
  for (const list of r.rows) {
    const entries = Array.isArray(list.entries) ? list.entries : [];
    for (const raw of entries) {
      const e = (raw ?? {}) as Record<string, unknown>;
      if (normalizeTsdDocumentId(String(e.documentId ?? "")) !== doc) continue;
      const code = String(e.code ?? "").trim();
      if (!code) continue;
      const qty = Number(e.qty);
      rows.push({
        code,
        itemCode: e.itemCode ? String(e.itemCode).trim() : null,
        itemName: e.itemName ? String(e.itemName).trim() : null,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        stickerStatus: e.stickerStatus ? String(e.stickerStatus) : null,
        itemStatus: e.itemStatus ? String(e.itemStatus) : null,
        emissionAtIso: e.emissionAtIso ? String(e.emissionAtIso) : null,
        expiryState: e.expiryState ? String(e.expiryState) : null,
      });
    }
  }
  return rows;
}

/**
 * Сканы всех документов площадки одним запросом.
 * Лента приёмки раньше запрашивала сканы отдельно для каждой сессии: при 45 сессиях
 * и документе на 7000 сканов это давало 20+ секунд на один GET.
 */
export async function listReceivingScanRowsBySite(
  client: PoolClient,
  siteId: number
): Promise<Map<string, ReceivingScanRow[]>> {
  const r = await client.query<{
    documentId: string;
    code: string;
    itemCode: string | null;
    itemName: string | null;
    qty: string | null;
    stickerStatus: string | null;
    itemStatus: string | null;
    emissionAtIso: string | null;
    expiryState: string | null;
  }>(
    `SELECT
       upper(trim(COALESCE(e->>'documentId', ''))) AS "documentId",
       trim(COALESCE(e->>'code', '')) AS code,
       NULLIF(trim(COALESCE(e->>'itemCode', '')), '') AS "itemCode",
       NULLIF(trim(COALESCE(e->>'itemName', '')), '') AS "itemName",
       e->>'qty' AS qty,
       NULLIF(trim(COALESCE(e->>'stickerStatus', '')), '') AS "stickerStatus",
       NULLIF(trim(COALESCE(e->>'itemStatus', '')), '') AS "itemStatus",
       NULLIF(trim(COALESCE(e->>'emissionAtIso', '')), '') AS "emissionAtIso",
       NULLIF(trim(COALESCE(e->>'expiryState', '')), '') AS "expiryState"
     FROM wms_code_lists cl
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json ELSE '[]'::jsonb END
     ) AS e
     WHERE cl.site_id = $1
       AND cl.list_type = 'receiving_scan_event'
       AND NULLIF(trim(COALESCE(e->>'code', '')), '') IS NOT NULL
       AND NULLIF(trim(COALESCE(e->>'documentId', '')), '') IS NOT NULL`,
    [siteId]
  );
  const byDoc = new Map<string, ReceivingScanRow[]>();
  for (const row of r.rows) {
    const doc = normalizeTsdDocumentId(String(row.documentId ?? ""));
    if (!doc) continue;
    const qty = Number(row.qty);
    const list = byDoc.get(doc);
    const scan: ReceivingScanRow = {
      code: row.code,
      itemCode: row.itemCode,
      itemName: row.itemName,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      stickerStatus: row.stickerStatus,
      itemStatus: row.itemStatus,
      emissionAtIso: row.emissionAtIso,
      expiryState: row.expiryState,
    };
    if (list) list.push(scan);
    else byDoc.set(doc, [scan]);
  }
  return byDoc;
}

export type ReceivingPostedLine = {
  itemCode: string;
  emissionDay?: string;
  qty: number;
  lotCode?: string;
};

function parsePostedLinesFromEntry(e: Record<string, unknown>): ReceivingPostedLine[] {
  const raw = e.postedLines;
  if (!Array.isArray(raw)) return [];
  const out: ReceivingPostedLine[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const row = p as Record<string, unknown>;
    const itemCode = String(row.itemCode ?? "").trim();
    const qty = Number(row.qty);
    if (!itemCode || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({
      itemCode,
      emissionDay: row.emissionDay ? String(row.emissionDay) : undefined,
      qty,
      lotCode: row.lotCode ? String(row.lotCode) : undefined,
    });
  }
  return out;
}

function parseReceivingStockPostEntry(
  e: Record<string, unknown>,
  rowCreatedAt: string
): {
  documentId: string;
  postedAtIso: string | null;
  locationCode: string | null;
  totalQty: number | null;
  dismissedEmpty: boolean;
  postedLines: ReceivingPostedLine[];
} | null {
  const documentId = normalizeTsdDocumentId(String(e.documentId ?? e.code ?? ""));
  if (!documentId) return null;
  const note = String(e.note ?? "");
  const locMatch = note.match(/^posted:\d+:(.+?)(?::auto)?$/);
  const dismissedEmpty = note.startsWith("dismissed:empty");
  return {
    documentId,
    postedAtIso: dismissedEmpty ? null : String(e.scannedAtIso ?? rowCreatedAt ?? "") || null,
    locationCode: locMatch?.[1] ?? null,
    totalQty: Number.isFinite(Number(e.qty)) ? Number(e.qty) : null,
    dismissedEmpty,
    postedLines: dismissedEmpty ? [] : parsePostedLinesFromEntry(e),
  };
}

function linePostKey(itemCode: string, emissionDay: string): string {
  return `${itemCode}::${emissionDay}`;
}

async function lotAvailableAtLocation(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  lotCode: string,
  locationCode: string
): Promise<number> {
  const r = await client.query<{ qty: string }>(
    `SELECT COALESCE(SUM(sl.available_qty), 0)::float8 AS qty
     FROM wms_items i
     INNER JOIN wms_stock_balances sb
       ON sb.site_id = i.site_id AND sb.item_id = i.item_id
     INNER JOIN wms_locations l
       ON l.site_id = sb.site_id AND l.location_id = sb.location_id
     INNER JOIN wms_stock_lots sl ON sl.balance_id = sb.balance_id
     WHERE i.site_id = $1
       AND lower(trim(i.item_code)) = lower(trim($2))
       AND upper(trim(l.location_code)) = upper(trim($3))
       AND sl.lot_code = $4`,
    [siteId, itemCode, locationCode, lotCode]
  );
  const qty = Number(r.rows[0]?.qty ?? 0);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

type MergedStockPost = {
  postedAtIso: string | null;
  locationCode: string | null;
  locationCodes: string[];
  postedLines: ReceivingPostedLine[];
  dismissedEmpty: boolean;
};

type StockPostEntry = Awaited<ReturnType<typeof listReceivingStockPostsForSite>>[number];

function mergeStockPostsForDocument(forDoc: StockPostEntry[]): MergedStockPost | null {
  if (forDoc.length === 0) return null;
  if (forDoc.some((p) => p.dismissedEmpty)) {
    return {
      postedAtIso: null,
      locationCode: null,
      locationCodes: [],
      postedLines: [],
      dismissedEmpty: true,
    };
  }
  const byKey = new Map<string, ReceivingPostedLine>();
  const locationCodes = new Set<string>();
  let postedAtIso: string | null = null;
  let locationCode: string | null = null;
  for (const p of forDoc) {
    if (p.postedAtIso && (!postedAtIso || Date.parse(p.postedAtIso) > Date.parse(postedAtIso))) {
      postedAtIso = p.postedAtIso;
    }
    if (p.locationCode) {
      locationCode = p.locationCode;
      locationCodes.add(p.locationCode);
    }
    for (const line of p.postedLines) {
      const day = line.emissionDay ?? "unknown";
      const key = linePostKey(line.itemCode, day);
      const prev = byKey.get(key);
      if (!prev || line.qty > prev.qty) {
        byKey.set(key, { ...line, emissionDay: day });
      }
    }
  }
  return {
    postedAtIso,
    locationCode,
    locationCodes: Array.from(locationCodes),
    postedLines: Array.from(byKey.values()),
    dismissedEmpty: false,
  };
}

async function getMergedDocumentStockPost(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<MergedStockPost | null> {
  const doc = normalizeTsdDocumentId(documentId);
  const posts = await listReceivingStockPostsForSite(client, siteId, { limit: 2000 });
  return mergeStockPostsForDocument(posts.filter((p) => p.documentId === doc));
}

async function postedQtyForAggregatedLine(
  client: PoolClient,
  siteId: number,
  line: AggregatedReceivingLine,
  postedByKey: Map<string, number>,
  locationCodes: string[]
): Promise<number> {
  const key = linePostKey(line.itemCode, line.emissionDay);
  let postedQty = postedByKey.get(key) ?? 0;
  if (postedQty + 1e-9 >= line.qty || locationCodes.length === 0) return postedQty;
  for (const loc of locationCodes) {
    const onHand = await lotAvailableAtLocation(
      client,
      siteId,
      line.itemCode,
      line.lotCode,
      loc
    );
    postedQty = Math.max(postedQty, onHand);
    if (postedQty + 1e-9 >= line.qty) break;
  }
  return postedQty;
}

export async function receivingDocumentPostSummary(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<{
  hasPost: boolean;
  fullyPosted: boolean;
  pendingLineCount: number;
  postedAtIso: string | null;
  locationCode: string | null;
  dismissedEmpty: boolean;
}> {
  const scans = await listReceivingScanEventsForDocument(client, siteId, documentId);
  const rules = await loadReceivingSiteRules(client, siteId);
  const { lines } = aggregateScans(scans, rules);
  const merged = await getMergedDocumentStockPost(client, siteId, documentId);
  if (!merged || merged.dismissedEmpty) {
    const dismissed = Boolean(merged?.dismissedEmpty);
    return {
      hasPost: dismissed,
      fullyPosted: dismissed,
      pendingLineCount: dismissed ? 0 : lines.length,
      postedAtIso: null,
      locationCode: null,
      dismissedEmpty: dismissed,
    };
  }
  const postedByKey = new Map(
    merged.postedLines.map((l) => [linePostKey(l.itemCode, l.emissionDay ?? "unknown"), l.qty])
  );
  const locationCodes =
    merged.locationCodes?.length > 0
      ? merged.locationCodes
      : merged.locationCode
        ? [merged.locationCode]
        : [];
  let pendingLineCount = 0;
  for (const line of lines) {
    const postedQty = await postedQtyForAggregatedLine(
      client,
      siteId,
      line,
      postedByKey,
      locationCodes
    );
    if (postedQty + 1e-9 < line.qty) pendingLineCount += 1;
  }
  const hasPost = merged.postedLines.length > 0 || Boolean(merged.postedAtIso);
  return {
    hasPost,
    fullyPosted: lines.length > 0 && pendingLineCount === 0,
    pendingLineCount,
    postedAtIso: merged.postedAtIso,
    locationCode: merged.locationCode,
    dismissedEmpty: false,
  };
}

export type ReceivingPostSummary = {
  hasPost: boolean;
  fullyPosted: boolean;
  pendingLineCount: number;
  postedAtIso: string | null;
  locationCode: string | null;
  dismissedEmpty: boolean;
  /** Позиции, посчитанные из сканов: сколько строк и сколько единиц принято. */
  lineCount: number;
  totalQty: number;
  postedQty: number;
};

/**
 * Сводки проведения сразу по всем документам площадки: сканы и проведения читаются
 * по одному запросу, наличие в ячейках — одним пакетным запросом на все спорные строки.
 */
export async function receivingPostSummariesForSite(
  client: PoolClient,
  siteId: number,
  opts?: { scansByDocument?: Map<string, ReceivingScanRow[]> }
): Promise<Map<string, ReceivingPostSummary>> {
  const scansByDoc = opts?.scansByDocument ?? (await listReceivingScanRowsBySite(client, siteId));
  const rules = await loadReceivingSiteRules(client, siteId);
  const posts = await listReceivingStockPostsForSite(client, siteId, { limit: 2000 });

  const postsByDoc = new Map<string, StockPostEntry[]>();
  for (const p of posts) {
    const list = postsByDoc.get(p.documentId);
    if (list) list.push(p);
    else postsByDoc.set(p.documentId, [p]);
  }

  const documents = new Set<string>([...scansByDoc.keys(), ...postsByDoc.keys()]);

  type Pending = {
    documentId: string;
    lines: AggregatedReceivingLine[];
    merged: MergedStockPost;
    postedByKey: Map<string, number>;
    locationCodes: string[];
  };

  const out = new Map<string, ReceivingPostSummary>();
  const pending: Pending[] = [];
  const lotProbes = new Map<string, { itemCode: string; lotCode: string; locationCode: string }>();

  for (const documentId of documents) {
    const scans = scansByDoc.get(documentId) ?? [];
    const { lines } = aggregateScans(scans, rules);
    const lineCount = lines.length;
    const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);
    const merged = mergeStockPostsForDocument(postsByDoc.get(documentId) ?? []);

    if (!merged || merged.dismissedEmpty) {
      const dismissed = Boolean(merged?.dismissedEmpty);
      out.set(documentId, {
        hasPost: dismissed,
        fullyPosted: dismissed,
        pendingLineCount: dismissed ? 0 : lineCount,
        postedAtIso: null,
        locationCode: null,
        dismissedEmpty: dismissed,
        lineCount,
        totalQty,
        postedQty: 0,
      });
      continue;
    }

    const postedByKey = new Map(
      merged.postedLines.map((l) => [linePostKey(l.itemCode, l.emissionDay ?? "unknown"), l.qty])
    );
    const locationCodes =
      merged.locationCodes.length > 0
        ? merged.locationCodes
        : merged.locationCode
          ? [merged.locationCode]
          : [];

    for (const line of lines) {
      const posted = postedByKey.get(linePostKey(line.itemCode, line.emissionDay)) ?? 0;
      if (posted + 1e-9 >= line.qty) continue;
      for (const loc of locationCodes) {
        const key = `${line.itemCode}\u0000${line.lotCode}\u0000${loc}`;
        if (!lotProbes.has(key)) {
          lotProbes.set(key, { itemCode: line.itemCode, lotCode: line.lotCode, locationCode: loc });
        }
      }
    }
    pending.push({ documentId, lines, merged, postedByKey, locationCodes });
  }

  const onHand = await lotAvailableAtLocations(client, siteId, [...lotProbes.values()]);

  for (const p of pending) {
    let pendingLineCount = 0;
    let postedQty = 0;
    for (const line of p.lines) {
      let qty = p.postedByKey.get(linePostKey(line.itemCode, line.emissionDay)) ?? 0;
      if (qty + 1e-9 < line.qty) {
        for (const loc of p.locationCodes) {
          qty = Math.max(qty, onHand.get(`${line.itemCode}\u0000${line.lotCode}\u0000${loc}`) ?? 0);
          if (qty + 1e-9 >= line.qty) break;
        }
      }
      postedQty += Math.min(qty, line.qty);
      if (qty + 1e-9 < line.qty) pendingLineCount += 1;
    }
    out.set(p.documentId, {
      hasPost: p.merged.postedLines.length > 0 || Boolean(p.merged.postedAtIso),
      fullyPosted: p.lines.length > 0 && pendingLineCount === 0,
      pendingLineCount,
      postedAtIso: p.merged.postedAtIso,
      locationCode: p.merged.locationCode,
      dismissedEmpty: false,
      lineCount: p.lines.length,
      totalQty: p.lines.reduce((sum, l) => sum + l.qty, 0),
      postedQty,
    });
  }

  return out;
}

/** Наличие партий в ячейках одним запросом вместо запроса на каждую строку. */
async function lotAvailableAtLocations(
  client: PoolClient,
  siteId: number,
  probes: Array<{ itemCode: string; lotCode: string; locationCode: string }>
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (probes.length === 0) return out;
  const r = await client.query<{ idx: string; qty: string }>(
    `SELECT t.idx::text AS idx, COALESCE(SUM(sl.available_qty), 0)::float8 AS qty
     FROM unnest($2::text[], $3::text[], $4::text[]) WITH ORDINALITY AS t(item_code, lot_code, location_code, idx)
     LEFT JOIN wms_items i
       ON i.site_id = $1 AND lower(trim(i.item_code)) = lower(trim(t.item_code))
     LEFT JOIN wms_stock_balances sb
       ON sb.site_id = i.site_id AND sb.item_id = i.item_id
     LEFT JOIN wms_locations l
       ON l.site_id = sb.site_id
      AND l.location_id = sb.location_id
      AND upper(trim(l.location_code)) = upper(trim(t.location_code))
     LEFT JOIN wms_stock_lots sl
       ON sl.balance_id = sb.balance_id AND sl.lot_code = t.lot_code AND l.location_id IS NOT NULL
     GROUP BY t.idx`,
    [
      siteId,
      probes.map((p) => p.itemCode),
      probes.map((p) => p.lotCode),
      probes.map((p) => p.locationCode),
    ]
  );
  for (const row of r.rows) {
    const idx = Number(row.idx) - 1;
    const probe = probes[idx];
    if (!probe) continue;
    const qty = Number(row.qty);
    out.set(
      `${probe.itemCode}\u0000${probe.lotCode}\u0000${probe.locationCode}`,
      Number.isFinite(qty) && qty > 0 ? qty : 0
    );
  }
  return out;
}

async function hasStockPostMarker(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<{ postedAtIso: string | null; dismissedEmpty: boolean } | null> {
  const doc = normalizeTsdDocumentId(documentId);
  const r = await client.query<{ entries: unknown; createdAt: string }>(
    `SELECT entries_json AS entries, created_at AS "createdAt"
     FROM wms_code_lists
     WHERE site_id = $1 AND list_type = 'receiving_stock_post'
     ORDER BY created_at DESC
     LIMIT 200`,
    [siteId]
  );
  for (const row of r.rows) {
    const entries = Array.isArray(row.entries) ? row.entries : [];
    for (const raw of entries) {
      const e = (raw ?? {}) as Record<string, unknown>;
      const parsed = parseReceivingStockPostEntry(e, row.createdAt);
      if (!parsed || parsed.documentId !== doc) continue;
      return { postedAtIso: parsed.postedAtIso, dismissedEmpty: parsed.dismissedEmpty };
    }
  }
  return null;
}

async function getLatestReceivingSessionStatus(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<string | null> {
  const doc = normalizeTsdDocumentId(documentId);
  const r = await client.query<{ status: string }>(
    `SELECT lower(trim(COALESCE(NULLIF(trim(e->>'note'), ''), NULLIF(trim(e->>'status'), ''), 'active'))) AS status
     FROM wms_code_lists cl
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE
         WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json
         ELSE '[]'::jsonb
       END
     ) AS e
     WHERE cl.site_id = $1
       AND cl.list_type = 'receiving_session_status'
       AND upper(trim(COALESCE(e->>'documentId', e->>'code', ''))) = $2
     ORDER BY COALESCE(NULLIF(trim(e->>'scannedAtIso'), ''), cl.created_at::text) DESC NULLS LAST
     LIMIT 1`,
    [siteId, doc]
  );
  return r.rows[0]?.status ?? null;
}

async function resolveDefaultReceivingLocation(
  client: PoolClient,
  siteId: number,
  preferredCode?: string
): Promise<{ locationId: string; locationCode: string }> {
  const preferred = preferredCode?.trim();
  if (preferred) {
    const loc = await resolveLocation(client, siteId, preferred);
    if (loc) {
      return { locationId: loc.location_id, locationCode: loc.location_code };
    }
    throw new WmsHttpError(
      404,
      `Ячейка «${preferred}» не найдена. Проверьте код в настройках приёмки.`,
      "receiving_location_not_found"
    );
  }
  const r = await client.query<{ locationId: string; locationCode: string }>(
    `SELECT l.location_id::text AS "locationId", l.location_code AS "locationCode"
     FROM wms_locations l
     JOIN wms_zones z ON z.zone_id = l.zone_id
     WHERE l.site_id = $1
       AND l.location_status_id <> 2
       AND (
         z.zone_code = 'RECV'
         OR z.name ILIKE '%приём%'
         OR z.name ILIKE '%прием%'
         OR l.display_name ILIKE '%приём%'
         OR l.display_name ILIKE '%прием%'
         OR l.location_code ILIKE '%RECV%'
       )
     ORDER BY
       CASE WHEN z.zone_code = 'RECV' THEN 0 ELSE 1 END,
       l.location_code
     LIMIT 1`,
    [siteId]
  );
  const row = r.rows[0];
  if (!row) {
    throw new WmsHttpError(
      400,
      "Не найдена ячейка приёмки. Откройте «Настройки проведения на остаток» на этой странице и укажите код ячейки зоны RECV. Либо создайте зону RECV и ячейку в разделе «Ячейки».",
      "receiving_location_missing"
    );
  }
  return row;
}

function storageCellMissingError(req: ItemSlotRequirements, hint?: string): WmsHttpError {
  const need = buildSlotDisplayName(req);
  const extra = hint ? ` ${hint}` : "";
  const suggestion = buildReceivingCellCreationSuggestion(req);
  return new WmsHttpError(
    400,
    `Проведение невозможно: для номенклатуры «${req.itemName}» (${req.itemCode}) нет ячейки хранения с подходящим профилем. ` +
      `Требуется: ${need}.${extra}`,
    "receiving_storage_cell_missing",
    suggestion
  );
}

async function resolvePostingLocation(
  client: PoolClient,
  siteId: number,
  input: {
    preferredCode?: string;
    lines: AggregatedReceivingLine[];
    preferReceiving?: boolean;
  }
): Promise<{
  locationId: string;
  locationCode: string;
  autoRecommended: boolean;
  preferredMissing?: string | null;
}> {
  const preferred = input.preferredCode?.trim();
  if (preferred) {
    const loc = await resolveLocation(client, siteId, preferred);
    if (loc) {
      return {
        locationId: loc.location_id,
        locationCode: loc.location_code,
        autoRecommended: false,
      };
    }
    // RCV-01 и т.п. из настроек часто не существуют — не блокируем проведение, подберём ячейку
  }

  const dominant = [...input.lines].sort((a, b) => b.qty - a.qty)[0];
  if (!dominant?.itemCode?.trim()) {
    throw new WmsHttpError(
      400,
      "Проведение невозможно: в сканах нет кода номенклатуры для подбора ячейки.",
      "receiving_item_code_missing"
    );
  }

  try {
    const { requirements, recommendations } = await recommendStorageLocations(client, siteId, {
      itemCode: dominant.itemCode,
      qty: dominant.qty,
      preferReceiving: input.preferReceiving ?? false,
      limit: 12,
    });

    const allowed = recommendations.filter((r) => !r.forbidden);
    const best = allowed[0];
    if (best?.locationId && best.locationCode) {
      return {
        locationId: best.locationId,
        locationCode: best.locationCode,
        autoRecommended: true,
        preferredMissing: preferred || null,
      };
    }

    if (recommendations.length === 0) {
      throw storageCellMissingError(
        requirements,
        "В системе нет ячеек с настроенным профилем хранения."
      );
    }

    const sample = recommendations[0];
    const reason = sample?.reasons?.find(Boolean) ?? "нет подходящего профиля";
    throw storageCellMissingError(requirements, `Ближайшая ячейка не подходит: ${reason}.`);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      if (error.code === "item_not_found") {
        throw new WmsHttpError(
          404,
          `Проведение невозможно: номенклатура «${dominant.itemCode}» не найдена в справочнике WMS.`,
          "item_not_found"
        );
      }
      throw error;
    }
    throw error;
  }
}

function aggregateScans(
  scans: ReceivingScanRow[],
  rules?: ReceivingSiteRules,
  productGroup?: string | null,
  confirmExpired = false
): {
  lines: AggregatedReceivingLine[];
  skipped: Array<{ code: string; reason: string }>;
} {
  const skipped: Array<{ code: string; reason: string }> = [];
  const map = new Map<string, AggregatedReceivingLine>();

  for (const scan of scans) {
    const gate = receivingScanGateFromRow(scan, rules, productGroup);
    if (!isReceivingScanPostable(gate, confirmExpired)) {
      skipped.push({
        code: scan.code,
        reason: gate.reason || "Скан не принят к остатку (статус ЧЗ или срок годности)",
      });
      continue;
    }
    const itemCode = (scan.itemCode ?? "").trim();
    if (!itemCode) {
      skipped.push({ code: scan.code, reason: "Нет itemCode в скане" });
      continue;
    }
    const emissionDay = emissionDayKey(scan.emissionAtIso);
    const key = `${itemCode}::${emissionDay}`;
    const existing = map.get(key);
    if (existing) {
      existing.qty += scan.qty;
      existing.scanCount += 1;
      if (!existing.emissionAtIso && scan.emissionAtIso) {
        existing.emissionAtIso = scan.emissionAtIso;
      }
    } else {
      map.set(key, {
        itemCode,
        itemName: scan.itemName,
        emissionDay,
        emissionAtIso: scan.emissionAtIso,
        qty: scan.qty,
        scanCount: 1,
        lotCode: buildLotCode(itemCode, emissionDay),
      });
    }
  }

  return { lines: Array.from(map.values()), skipped };
}

export async function finalizeReceivingSession(
  client: PoolClient,
  siteId: number,
  input: {
    documentId: string;
    deviceUid: string;
    targetLocationCode?: string;
    productGroup?: string;
    confirmExpired?: boolean;
    lineTargets?: ReceivingLineTarget[];
  }
): Promise<FinalizeReceivingResult> {
  const documentId = normalizeTsdDocumentId(input.documentId);
  if (!documentId) {
    throw new WmsHttpError(400, "documentId is required", "bad_document_id");
  }

  const priorPost = await getMergedDocumentStockPost(client, siteId, documentId);
  if (priorPost?.dismissedEmpty) {
    throw new WmsHttpError(
      400,
      "Документ снят с учёта как пустой — проведение на остаток недоступно.",
      "receiving_session_dismissed"
    );
  }

  const rules = await loadReceivingSiteRules(client, siteId);
  const inbound = await getReceivingInbound(client, siteId, documentId);
  const scans = await listReceivingScanEventsForDocument(client, siteId, documentId);
  const crptSample = await sampleCrptLotDates(scans.map((s) => s.code));
  if (crptSample?.emissionAt) {
    for (const scan of scans) {
      if (scan.code.trim()) scan.emissionAtIso = crptSample.emissionAt;
    }
  }
  const { lines, skipped } = aggregateScans(
    scans,
    rules,
    input.productGroup,
    input.confirmExpired === true
  );
  if (lines.length === 0) {
    throw new WmsHttpError(
      400,
      "Нет принятых сканов для проводки на остаток по правилу площадки",
      "no_postable_scans"
    );
  }
  const inboundSplitsByItem = new Map<string, ReceivingLineSplit[]>();
  for (const line of inbound?.lines ?? []) {
    const code = line.itemCode.trim().toUpperCase();
    if (!code) continue;
    const splits = parseReceivingSplits(line.splits);
    if (splits.length > 0) inboundSplitsByItem.set(code, splits);
    else if (line.targetLocationCode.trim()) {
      inboundSplitsByItem.set(code, [
        { locationCode: line.targetLocationCode.trim(), qty: 0, lpnCode: "", lpnKind: "" },
      ]);
    }
  }
  const fallbackLocation =
    input.targetLocationCode?.trim() || rules.defaultTargetLocationCode || undefined;
  const destinationsOf = (line: AggregatedReceivingLine) =>
    destinationsForLine(
      line,
      input.lineTargets ?? [],
      inboundSplitsByItem.get(line.itemCode.trim().toUpperCase()) ?? [],
      fallbackLocation
    );

  const postedKeys = new Set(
    (priorPost?.postedLines ?? []).map((l) =>
      linePostKey(l.itemCode, l.emissionDay ?? "unknown")
    )
  );
  const linesToPost: AggregatedReceivingLine[] = [];
  for (const line of lines) {
    const key = linePostKey(line.itemCode, line.emissionDay);
    if (postedKeys.has(key)) continue;
    if (priorPost && priorPost.postedLines.length === 0) {
      const locs =
        priorPost.locationCodes?.length > 0
          ? priorPost.locationCodes
          : priorPost.locationCode
            ? [priorPost.locationCode]
            : [];
      if (locs.length > 0) {
        let onHand = 0;
        for (const loc of locs) {
          onHand = Math.max(
            onHand,
            await lotAvailableAtLocation(client, siteId, line.itemCode, line.lotCode, loc)
          );
          if (onHand + 1e-9 >= line.qty) break;
        }
        if (onHand + 1e-9 >= line.qty) continue;
      }
    }
    linesToPost.push(line);
  }

  if (linesToPost.length === 0) {
    return {
      documentId,
      locationCode: priorPost?.locationCode ?? "—",
      alreadyPosted: true,
      lines,
      movementsCreated: 0,
      skippedScans: skipped,
      postedAtIso: priorPost?.postedAtIso ?? null,
      postingNote: null,
    };
  }

  const stickerPost =
    isStickersReceivingContext({ productGroup: input.productGroup }) ||
    documentId.startsWith("PRT-");
  if (stickerPost) {
    for (const line of linesToPost) {
      const gtin = normalizePrintedGtin(line.itemCode);
      if (!gtin) continue;
      const ensured = await ensurePrintedStickerItem(client, siteId, {
        gtin,
        productName: line.itemName || line.itemCode,
      });
      line.itemCode = ensured.itemCode;
      line.itemName = ensured.name;
    }
  }

  const requestId = randomUUID();
  let movementsCreated = 0;
  const postedThisRun: ReceivingPostedLine[] = [];
  const skippedLines: Array<{ code: string; reason: string }> = [];
  const usedLocations = new Set<string>();
  let autoRecommendedAny = false;
  let preferredMissing: string | null = null;

  await client.query("BEGIN");
  try {
    for (const line of linesToPost) {
      const destinations = destinationsOf(line);
      if (destinations.length === 0) {
        skippedLines.push({
          code: line.itemCode,
          reason: `Нет ячейки для ${line.itemCode}`,
        });
        continue;
      }

      const item = await resolveItemByCodeOrBarcode(client, siteId, line.itemCode);
      if (!item) {
        throw new WmsHttpError(
          404,
          `Номенклатура не найдена: ${line.itemCode}`,
          "item_not_found"
        );
      }

      const manufacturedAt = line.emissionAtIso ?? undefined;
      const shelfLifeR = await client.query<{ shelfLifeDays: number | null }>(
        `SELECT COALESCE(shelf_life_days, $2)::int AS "shelfLifeDays"
         FROM wms_items WHERE item_id = $1::bigint`,
        [item.item_id, DEFAULT_CODE_SHELF_LIFE_DAYS]
      );
      const shelfLifeDays = Number(shelfLifeR.rows[0]?.shelfLifeDays ?? DEFAULT_CODE_SHELF_LIFE_DAYS);
      const expiryCheck = computeCodeExpiry(
        manufacturedAt ?? line.emissionDay,
        shelfLifeDays,
        0,
        crptSample?.expiresAt ?? undefined
      );
      const expiryAt = expiryCheck.expiresAt ?? undefined;
      const lotId = await ensureWmsLot(
        client,
        siteId,
        item.item_id,
        line.lotCode,
        `Приёмка ${documentId} · эмиссия ${line.emissionDay}`,
        manufacturedAt,
        undefined,
        expiryAt
      );
      if (!lotId) {
        throw new WmsHttpError(500, "Не удалось создать партию", "lot_create_failed");
      }

      for (const dest of destinations) {
        let locationId: string;
        let lineLocationCode: string;
        try {
          const resolved = await resolvePostingLocation(client, siteId, {
            preferredCode: dest.locationCode,
            lines: [{ ...line, qty: dest.qty }],
            preferReceiving: false,
          });
          locationId = resolved.locationId;
          lineLocationCode = resolved.locationCode;
          if (resolved.autoRecommended) autoRecommendedAny = true;
          if (resolved.preferredMissing) preferredMissing = resolved.preferredMissing;
        } catch (error) {
          const loc = dest.locationCode
            ? await resolveLocation(client, siteId, dest.locationCode)
            : null;
          if (!loc) {
            skippedLines.push({
              code: line.itemCode,
              reason:
                error instanceof WmsHttpError
                  ? error.message
                  : `Нет ячейки для ${line.itemCode}`,
            });
            continue;
          }
          locationId = loc.location_id;
          lineLocationCode = loc.location_code;
        }
        usedLocations.add(lineLocationCode);

        await applyStockReceipt(client, {
          siteId,
          itemId: item.item_id,
          toLocationId: locationId,
          qty: dest.qty,
          lotId,
          lotCode: line.lotCode,
          lotExpiryAt: expiryAt,
          requestId,
          payload: {
            receivingFinalize: {
              documentId,
              emissionDay: line.emissionDay,
              lpnCode: dest.lpnCode || null,
              lpnKind: dest.lpnKind || null,
            },
          },
        });
        movementsCreated += 1;
        postedThisRun.push({
          itemCode: line.itemCode,
          emissionDay: line.emissionDay,
          qty: dest.qty,
          lotCode: line.lotCode,
        });
      }
    }

    if (movementsCreated === 0) {
      const first = skippedLines[0];
      throw new WmsHttpError(
        400,
        first?.reason ??
          "Не удалось провести ни одну позицию. Укажите ячейку в настройках приёмки или выберите её в подборе ниже.",
        "receiving_storage_cell_missing"
      );
    }

    const locationCodes = [...usedLocations];
    const primaryLocationCode = locationCodes[0] ?? "—";
    const postedAtIso = new Date().toISOString();
    await createCodeList(client, siteId, {
      requestId: randomUUID(),
      deviceUid: input.deviceUid,
      listType: "receiving_stock_post",
      entries: [
        {
          kind: "code",
          code: documentId,
          documentId,
          scannedAtIso: postedAtIso,
          note: `posted:${movementsCreated}:${primaryLocationCode}${autoRecommendedAny ? ":auto" : ""}`,
          qty: linesToPost.reduce((s, l) => s + l.qty, 0),
          itemCode: input.productGroup ?? undefined,
          postedLines: postedThisRun,
        },
      ],
    });

    await client.query("COMMIT");

    const skippedNote =
      skippedLines.length > 0
        ? `Не проведено позиций: ${skippedLines.length} (${skippedLines.map((s) => s.code).join(", ")}). Укажите ячейку вручную в настройках приёмки.`
        : null;

    const postingNote = [
      preferredMissing
        ? `Ячейка «${preferredMissing}» не найдена — подобрана ячейка по профилю номенклатуры.`
        : autoRecommendedAny
          ? locationCodes.length === 1
            ? `Остаток проведён в «${primaryLocationCode}» (подбор по профилю).`
            : `Остаток проведён в ячейки: ${locationCodes.join(", ")} (подбор по профилю).`
          : locationCodes.length > 1
            ? `Остаток проведён в ячейки: ${locationCodes.join(", ")}.`
            : null,
      skippedNote,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      documentId,
      locationCode: primaryLocationCode,
      alreadyPosted: Boolean(priorPost?.postedLines.length),
      lines,
      movementsCreated,
      skippedScans: [...skipped, ...skippedLines],
      postedAtIso,
      postingNote: postingNote || null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function dismissEmptyReceivingSession(
  client: PoolClient,
  siteId: number,
  input: {
    documentId: string;
    deviceUid: string;
  }
): Promise<DismissEmptyReceivingResult> {
  const documentId = normalizeTsdDocumentId(input.documentId);
  if (!documentId) {
    throw new WmsHttpError(400, "documentId is required", "bad_document_id");
  }

  const existing = await hasStockPostMarker(client, siteId, documentId);
  if (existing) {
    return {
      documentId,
      alreadyDismissed: existing.dismissedEmpty,
      dismissedAtIso: existing.postedAtIso,
    };
  }

  const scans = await listReceivingScanEventsForDocument(client, siteId, documentId);
  if (scans.length > 0) {
    throw new WmsHttpError(
      400,
      "В сессии есть сканы — используйте «Провести на остаток», а не снятие с учёта.",
      "receiving_session_not_empty"
    );
  }

  const status = await getLatestReceivingSessionStatus(client, siteId, documentId);
  if (status === "active" || status === "paused") {
    throw new WmsHttpError(
      400,
      "Сначала закройте документ на ТСД или кнопкой «Закрыть» в списке приёмки.",
      "receiving_session_not_closed"
    );
  }

  const dismissedAtIso = new Date().toISOString();
  await createCodeList(client, siteId, {
    requestId: randomUUID(),
    deviceUid: input.deviceUid,
    listType: "receiving_stock_post",
    entries: [
      {
        kind: "code",
        code: documentId,
        documentId,
        scannedAtIso: dismissedAtIso,
        note: "dismissed:empty",
        qty: 0,
      },
    ],
  });

  return {
    documentId,
    alreadyDismissed: false,
    dismissedAtIso,
  };
}

export async function listReceivingStockPostsForSite(
  client: PoolClient,
  siteId: number,
  opts?: { limit?: number }
): Promise<
  Array<{
    documentId: string;
    postedAtIso: string | null;
    locationCode: string | null;
    totalQty: number | null;
    dismissedEmpty: boolean;
    postedLines: ReceivingPostedLine[];
  }>
> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 500, 2000));
  const r = await client.query<{ entries: unknown; createdAt: string }>(
    `SELECT entries_json AS entries, created_at AS "createdAt"
     FROM wms_code_lists
     WHERE site_id = $1 AND list_type = 'receiving_stock_post'
     ORDER BY created_at DESC
     LIMIT $2`,
    [siteId, limit]
  );
  const out: Array<{
    documentId: string;
    postedAtIso: string | null;
    locationCode: string | null;
    totalQty: number | null;
    dismissedEmpty: boolean;
    postedLines: ReceivingPostedLine[];
  }> = [];
  for (const row of r.rows) {
    const entries = Array.isArray(row.entries) ? row.entries : [];
    for (const raw of entries) {
      const e = (raw ?? {}) as Record<string, unknown>;
      const parsed = parseReceivingStockPostEntry(e, row.createdAt);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}
