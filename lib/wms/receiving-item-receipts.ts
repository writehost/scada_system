import type { PoolClient } from "pg";
import { normalizeTsdDocumentId } from "@/lib/wms/receiving-tsd-sessions";
import {
  listReceivingStockPostsForSite,
  type ReceivingPostedLine,
} from "@/lib/wms/receiving-finalize";

function emissionDayKey(emissionAtIso: string | null | undefined): string {
  if (!emissionAtIso?.trim()) return "unknown";
  const d = new Date(emissionAtIso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function fmtEmissionDayLabel(day: string, iso: string | null): string {
  if (iso) {
    try {
      return new Date(iso).toLocaleDateString("ru-RU");
    } catch {
      /* fall through */
    }
  }
  if (day.length === 8 && day !== "unknown") {
    return `${day.slice(6, 8)}.${day.slice(4, 6)}.${day.slice(0, 4)}`;
  }
  return "—";
}

function buildLotCode(itemCode: string, emissionDay: string): string {
  const safeItem = itemCode.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "ITEM";
  return `RCV-${emissionDay}-${safeItem}`;
}

function postedQtyFromLines(
  postedLines: ReceivingPostedLine[],
  itemCode: string,
  emissionDay: string
): number {
  let sum = 0;
  for (const line of postedLines) {
    if (line.itemCode !== itemCode) continue;
    const lineDay = line.emissionDay ?? "unknown";
    if (
      lineDay !== emissionDay &&
      lineDay !== "unknown" &&
      emissionDay !== "unknown"
    ) {
      continue;
    }
    sum += line.qty;
  }
  return sum;
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

export type ItemReceivingReceiptRow = {
  documentId: string;
  postedAtIso: string | null;
  locationCode: string | null;
  emissionDay: string;
  emissionAtIso: string | null;
  emissionLabel: string;
  /** Сумма сканов в сессии по этой эмиссии. */
  qty: number;
  /** Фактически проведено на остаток (0 — только скан). */
  postedQty: number;
  scanCount: number;
  lotCode: string;
  stockPosted: boolean;
  /** Сессия проведена, но эта позиция в проводку не попала. */
  sessionPostedOtherLines: boolean;
};

/** Строки приёмки по документам ТСД для одной номенклатуры (одна эмиссия — разные даты проведения). */
export async function listItemReceivingReceipts(
  client: PoolClient,
  siteId: number,
  itemCode: string
): Promise<ItemReceivingReceiptRow[]> {
  const code = itemCode.trim();
  if (!code) return [];

  /**
   * Отбор по номенклатуре делает база: журнал сканирований занимает сотни
   * килобайт, а тянуть его целиком через туннель на каждую карточку дорого.
   */
  const r = await client.query<{
    documentId: string | null;
    emissionAtIso: string | null;
    qty: number | null;
    scanCount: number | null;
  }>(
    `SELECT
       e.value->>'documentId' AS "documentId",
       NULLIF(e.value->>'emissionAtIso', '') AS "emissionAtIso",
       SUM(
         CASE
           WHEN (e.value->>'qty') ~ '^[0-9]+(\\.[0-9]+)?$' AND (e.value->>'qty')::numeric > 0
             THEN (e.value->>'qty')::numeric
           ELSE 1
         END
       )::float8 AS qty,
       COUNT(*)::int AS "scanCount"
     FROM (
       SELECT entries_json
       FROM wms_code_lists
       WHERE site_id = $1
         AND list_type = 'receiving_scan_event'
         AND jsonb_typeof(entries_json) = 'array'
       ORDER BY created_at DESC
       LIMIT 3000
     ) cl
     CROSS JOIN LATERAL jsonb_array_elements(cl.entries_json) AS e(value)
     WHERE btrim(COALESCE(e.value->>'itemCode', '')) = $2
     GROUP BY 1, 2`,
    [siteId, code]
  );

  type Agg = {
    documentId: string;
    emissionDay: string;
    emissionAtIso: string | null;
    qty: number;
    scanCount: number;
  };

  const map = new Map<string, Agg>();

  for (const row of r.rows) {
    const documentId = normalizeTsdDocumentId(String(row.documentId ?? ""));
    if (!documentId) continue;
    const emissionAtIso = row.emissionAtIso ? String(row.emissionAtIso) : null;
    const emissionDay = emissionDayKey(emissionAtIso);
    const key = `${documentId}::${emissionDay}`;
    const cur = map.get(key) ?? {
      documentId,
      emissionDay,
      emissionAtIso,
      qty: 0,
      scanCount: 0,
    };
    cur.qty += Number(row.qty ?? 0) || 0;
    cur.scanCount += Number(row.scanCount ?? 0) || 0;
    if (!cur.emissionAtIso && emissionAtIso) cur.emissionAtIso = emissionAtIso;
    map.set(key, cur);
  }

  if (map.size === 0) return [];

  const posts = await listReceivingStockPostsForSite(client, siteId, { limit: 2000 });
  const postByDoc = new Map<
    string,
    {
      postedAtIso: string | null;
      locationCode: string | null;
      postedLines: ReceivingPostedLine[];
    }
  >();
  for (const p of posts) {
    const prev = postByDoc.get(p.documentId);
    if (!prev || Date.parse(p.postedAtIso || "") > Date.parse(prev.postedAtIso || "")) {
      postByDoc.set(p.documentId, {
        postedAtIso: p.postedAtIso,
        locationCode: p.locationCode,
        postedLines: p.postedLines,
      });
    }
  }

  const rows: ItemReceivingReceiptRow[] = [];
  for (const agg of map.values()) {
    const post = postByDoc.get(agg.documentId);
    const lotCode = buildLotCode(code, agg.emissionDay);
    let postedQty = post ? postedQtyFromLines(post.postedLines, code, agg.emissionDay) : 0;

    if (postedQty <= 0 && post?.postedAtIso && post.locationCode) {
      postedQty = await lotAvailableAtLocation(
        client,
        siteId,
        code,
        lotCode,
        post.locationCode
      );
    }

    const sessionPostedOtherLines = Boolean(
      post?.postedAtIso && postedQty <= 0 && agg.qty > 0
    );
    const stockPosted = postedQty > 0;

    rows.push({
      documentId: agg.documentId,
      postedAtIso: stockPosted ? post?.postedAtIso ?? null : null,
      locationCode: stockPosted ? post?.locationCode ?? null : null,
      emissionDay: agg.emissionDay,
      emissionAtIso: agg.emissionAtIso,
      emissionLabel: fmtEmissionDayLabel(agg.emissionDay, agg.emissionAtIso),
      qty: agg.qty,
      postedQty,
      scanCount: agg.scanCount,
      lotCode,
      stockPosted,
      sessionPostedOtherLines,
    });
  }

  rows.sort((a, b) => {
    const ta = Date.parse(a.postedAtIso || "");
    const tb = Date.parse(b.postedAtIso || "");
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
    if (a.postedAtIso && !b.postedAtIso) return -1;
    if (!a.postedAtIso && b.postedAtIso) return 1;
    return a.documentId.localeCompare(b.documentId);
  });

  return rows;
}
