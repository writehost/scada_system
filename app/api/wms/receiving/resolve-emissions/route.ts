import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { normalizeTsdDocumentId } from "@/lib/wms/receiving-tsd-sessions";
import { resolveReceivingScan } from "@/lib/wms/receiving-crpt";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ограничиваем разовое уточнение: каждый код — это запрос в ЧЗ. */
const MAX_CODES_PER_CALL = 25;
/** Одну сессию не уточняем чаще этого интервала. */
const MIN_INTERVAL_MS = 60_000;
const lastRun = new Map<string, number>();

/**
 * Дозаполняет дату эмиссии у сканов сессии.
 * Раньше это делала лента приёмки на каждом GET: опрос раз в 2.5 секунды превращался
 * в поток запросов в ЧЗ и перезапись entries_json целиком.
 */
export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    siteCode?: string;
    documentId?: string;
  };
  const siteCode = (body.siteCode ?? "").trim();
  const documentId = normalizeTsdDocumentId(body.documentId ?? "");
  if (!siteCode || !documentId) {
    return NextResponse.json({ error: "siteCode and documentId are required" }, { status: 400 });
  }

  const throttleKey = `${siteCode}|${documentId}`;
  const last = lastRun.get(throttleKey) ?? 0;
  if (Date.now() - last < MIN_INTERVAL_MS) {
    return NextResponse.json({ resolved: 0, remaining: null, throttled: true });
  }
  lastRun.set(throttleKey, Date.now());

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const lists = await client.query<{ codeListId: string; entries: unknown }>(
      `SELECT code_list_id::text AS "codeListId", entries_json AS entries
       FROM wms_code_lists cl
       WHERE cl.site_id = $1
         AND cl.list_type = 'receiving_scan_event'
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json ELSE '[]'::jsonb END
           ) e
           WHERE upper(trim(COALESCE(e->>'documentId', ''))) = $2
             AND NULLIF(trim(COALESCE(e->>'emissionAtIso', '')), '') IS NULL
         )
       ORDER BY cl.created_at DESC, cl.code_list_id DESC`,
      [siteId, documentId]
    );

    let resolved = 0;
    let remaining = 0;
    let budget = MAX_CODES_PER_CALL;

    for (const list of lists.rows) {
      const entries = Array.isArray(list.entries) ? [...(list.entries as unknown[])] : [];
      let touched = false;
      for (let i = 0; i < entries.length; i += 1) {
        const e = (entries[i] ?? {}) as Record<string, unknown>;
        if (normalizeTsdDocumentId(String(e.documentId ?? "")) !== documentId) continue;
        if (String(e.emissionAtIso ?? "").trim()) continue;
        const code = String(e.code ?? "").trim();
        if (!code) continue;
        if (budget <= 0) {
          remaining += 1;
          continue;
        }
        budget -= 1;
        try {
          const result = await resolveReceivingScan(client, siteId, code);
          const emissionAtIso = result.expiry.emissionAt;
          if (emissionAtIso) {
            entries[i] = { ...e, emissionAtIso };
            touched = true;
            resolved += 1;
          }
        } catch {
          // ЧЗ может быть недоступен: карточка должна работать и без уточнения.
        }
      }
      if (touched) {
        await client.query(
          `UPDATE wms_code_lists
           SET entries_json = $3::jsonb
           WHERE site_id = $1 AND code_list_id = $2::bigint`,
          [siteId, list.codeListId, JSON.stringify(entries)]
        );
      }
    }

    return NextResponse.json({ resolved, remaining, throttled: false });
  } finally {
    client.release();
  }
}
