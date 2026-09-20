import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireDeviceByUid } from "@/lib/wms/devices";

export type CodeListType =
  | "pallet_extract"
  | "scanner_collect"
  | "receiving_scan_event"
  | "receiving_batch_sticker"
  | "receiving_session_status"
  | "receiving_stock_post"
  | "missing_nomenclature"
  | "aggregation_block_doc"
  | "aggregation_pallet_doc"
  | "aggregation_extract_doc";

export type CodeListEntry =
  | {
      kind: "package";
      packageCode: string;
      nestedCodes?: string[];
    }
  | {
      kind: "code" | "scan";
      code: string;
      scannedAtIso?: string;
      documentId?: string;
      itemCode?: string;
      itemName?: string;
      qty?: number;
      note?: string;
      comment?: string | null;
      /** Статус кода в ЧЗ: INTRODUCED, WRITTEN_OFF, … */
      stickerStatus?: string;
      /** Локальный статус приёмки: эмитирован, просрочен, … */
      itemStatus?: string;
      emissionAtIso?: string;
      emissionAt?: string;
      emissionDate?: string;
      manufacturedAt?: string;
      expiryState?: string;
      /** Разбивка проведения на остаток: по каким позициям и сколько легло в ячейку. */
      postedLines?: Array<{
        itemCode: string;
        emissionDay?: string;
        qty: number;
        lotCode?: string;
      }>;
    };

export async function createCodeList(
  client: PoolClient,
  siteId: number,
  input: {
    requestId: string;
    deviceUid: string;
    listType: CodeListType;
    palletCode?: string | null;
    reasonCode?: string | null;
    entries: CodeListEntry[];
  }
) {
  const device = await requireDeviceByUid(client, siteId, input.deviceUid);
  const listType = (input.listType ?? "").trim();
  if (
    listType !== "pallet_extract" &&
    listType !== "scanner_collect" &&
    listType !== "receiving_scan_event" &&
    listType !== "receiving_batch_sticker" &&
    listType !== "receiving_session_status" &&
    listType !== "receiving_stock_post" &&
    listType !== "missing_nomenclature" &&
    listType !== "aggregation_block_doc" &&
    listType !== "aggregation_pallet_doc" &&
    listType !== "aggregation_extract_doc"
  ) {
    throw new WmsHttpError(400, "unsupported listType", "bad_list_type");
  }
  const entries = Array.isArray(input.entries) ? input.entries : [];
  if (entries.length === 0) {
    throw new WmsHttpError(400, "non-empty entries are required", "bad_entries");
  }

  const payload =
    listType === "pallet_extract"
      ? entries.map((e) => ({
          kind: "package",
          packageCode: String((e as any).packageCode ?? "").trim(),
          nestedCodes: Array.isArray((e as any).nestedCodes)
            ? (e as any).nestedCodes
                .map((c: unknown) => String(c ?? "").trim())
                .filter(Boolean)
            : [],
        }))
      : entries.map((e) => {
          const entry = e as Record<string, unknown>;
          const row: Record<string, unknown> = {
            kind:
              listType === "receiving_scan_event" || listType === "receiving_batch_sticker"
                ? "scan"
                : listType === "receiving_session_status" || listType === "receiving_stock_post"
                  ? "session"
                  : listType === "missing_nomenclature"
                    ? "missing_nomenclature"
                    : listType.startsWith("aggregation_")
                      ? "aggregation"
                      : "code",
            code: String(entry.code ?? "").trim(),
            scannedAtIso: String(entry.scannedAtIso ?? "").trim() || null,
            documentId: String(entry.documentId ?? "").trim() || null,
            itemCode: String(entry.itemCode ?? "").trim() || null,
            itemName: String(entry.itemName ?? "").trim() || null,
            qty: Number.isFinite(Number(entry.qty)) ? Number(entry.qty) : null,
            note: String(entry.note ?? "").trim() || null,
            comment: String(entry.comment ?? "").trim() || null,
          };
          if (listType === "receiving_scan_event" || listType === "receiving_batch_sticker") {
            row.emissionAtIso =
              String(
                entry.emissionAtIso ??
                  entry.emissionAt ??
                  entry.emissionDate ??
                  entry.manufacturedAt ??
                  ""
              ).trim() || null;
          }
          if (listType === "receiving_scan_event") {
            row.stickerStatus = String(entry.stickerStatus ?? "").trim() || null;
            row.itemStatus = String(entry.itemStatus ?? "").trim() || null;
            row.expiryState = String(entry.expiryState ?? "").trim() || null;
          }
          return row;
        });

  if (listType === "pallet_extract") {
    if (payload.some((e: any) => !e.packageCode)) {
      throw new WmsHttpError(400, "packageCode is required for each entry", "bad_package_code");
    }
  } else {
    if (payload.some((e: any) => !e.code)) {
      throw new WmsHttpError(400, "code is required for each entry", "bad_code");
    }
  }

  const r = await client.query<{ codeListId: string }>(
    `INSERT INTO wms_code_lists (
       request_id, site_id, device_id, device_uid, list_type, pallet_code, reason_code, entries_json
     ) VALUES (
       $1::uuid, $2, $3::bigint, $4, $5, $6, $7, $8::jsonb
     )
     ON CONFLICT (request_id)
     DO UPDATE SET
       device_id = EXCLUDED.device_id,
       device_uid = EXCLUDED.device_uid,
       list_type = EXCLUDED.list_type,
       pallet_code = EXCLUDED.pallet_code,
       reason_code = EXCLUDED.reason_code,
       entries_json = EXCLUDED.entries_json
     RETURNING code_list_id::text AS "codeListId"`,
    [
      input.requestId,
      siteId,
      device.deviceId,
      device.deviceUid,
      listType,
      (input.palletCode ?? "").trim() || null,
      (input.reasonCode ?? "").trim() || null,
      JSON.stringify(payload),
    ]
  );
  return { codeListId: r.rows[0]?.codeListId ?? null };
}

export async function listCodeListsForDevice(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  options?: { limit?: number }
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  const limit = Math.max(Math.min(Number(options?.limit ?? 20), 200), 1);
  const r = await client.query(
    `SELECT
       code_list_id::text AS "codeListId",
       list_type AS "listType",
       pallet_code AS "palletCode",
       reason_code AS "reasonCode",
       created_at AS "createdAt",
       entries_json AS "entries"
     FROM wms_code_lists
     WHERE site_id = $1 AND device_uid = $2
     ORDER BY created_at DESC, code_list_id DESC
     LIMIT $3`,
    [siteId, device.deviceUid, limit]
  );
  return { lists: r.rows };
}

/** Последний статус приёмки по каждому документу (отдельно от ленты сканов). */
export async function listReceivingSessionStatusesForSite(
  client: PoolClient,
  siteId: number,
  options?: { limit?: number }
) {
  const limit = Math.max(Math.min(Number(options?.limit ?? 800), 2000), 50);
  const r = await client.query(
    `SELECT
       device_uid AS "deviceUid",
       created_at AS "createdAt",
       entries_json AS "entries"
     FROM wms_code_lists
     WHERE site_id = $1 AND list_type = 'receiving_session_status'
     ORDER BY created_at DESC, code_list_id DESC
     LIMIT $2`,
    [siteId, limit]
  );
  return { lists: r.rows };
}

/** Актуальный статус по каждому documentId (не обрезается лимитом последних N строк code_lists). */
export async function listLatestReceivingSessionStatusesForSite(
  client: PoolClient,
  siteId: number,
  options?: { maxDocuments?: number }
) {
  const maxDocuments = Math.max(Math.min(Number(options?.maxDocuments ?? 500), 2000), 50);
  const r = await client.query(
    `SELECT DISTINCT ON (doc_key)
       doc_key AS "documentId",
       status,
       line_count AS "lineCount",
       updated_at_iso AS "updatedAtIso",
       device_uid AS "deviceUid",
       product_group AS "productGroup",
       item_name AS "itemName"
     FROM (
       SELECT
         upper(trim(COALESCE(e->>'documentId', e->>'code', ''))) AS doc_key,
         lower(trim(COALESCE(NULLIF(trim(e->>'note'), ''), 'active'))) AS status,
         CASE
           WHEN (e->>'qty') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (e->>'qty')::numeric
           ELSE NULL
         END AS line_count,
         COALESCE(NULLIF(trim(e->>'scannedAtIso'), ''), cl.created_at::text) AS updated_at_iso,
         cl.device_uid AS device_uid,
         NULLIF(trim(e->>'itemCode'), '') AS product_group,
         NULLIF(trim(e->>'itemName'), '') AS item_name
       FROM wms_code_lists cl
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json
           ELSE '[]'::jsonb
         END
       ) AS e
       WHERE cl.site_id = $1
         AND cl.list_type = 'receiving_session_status'
         AND trim(COALESCE(e->>'documentId', e->>'code', '')) <> ''
     ) raw
     ORDER BY doc_key, updated_at_iso DESC NULLS LAST
     LIMIT $2`,
    [siteId, maxDocuments]
  );
  return { sessions: r.rows };
}

export type ReceivingScanAggregate = {
  documentId: string;
  lineCount: number;
  totalQty: number;
  itemName: string | null;
  itemCode: string | null;
  allowedCount: number;
  blockedCount: number;
};

/** Полные итоги сканов по документу — без обрезки ленты code_lists. */
export async function listReceivingScanAggregatesForSite(
  client: PoolClient,
  siteId: number
): Promise<ReceivingScanAggregate[]> {
  const r = await client.query<ReceivingScanAggregate>(
    `SELECT
       upper(trim(e->>'documentId')) AS "documentId",
       count(*)::int AS "lineCount",
       coalesce(sum(
         CASE
           WHEN (e->>'qty') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (e->>'qty')::numeric
           ELSE 1
         END
       ), 0)::float8 AS "totalQty",
       max(nullif(trim(e->>'itemName'), '')) AS "itemName",
       max(nullif(trim(e->>'itemCode'), '')) AS "itemCode",
       count(*) FILTER (
         WHERE upper(trim(coalesce(e->>'stickerStatus', ''))) IN ('EMITTED', 'APPLIED', 'INTRODUCED')
           AND coalesce(e->>'expiryState', '') <> 'expired'
           AND coalesce(e->>'itemStatus', '') <> 'просрочен'
       )::int AS "allowedCount",
       count(*) FILTER (
         WHERE coalesce(e->>'expiryState', '') = 'expired'
            OR coalesce(e->>'itemStatus', '') = 'просрочен'
            OR upper(trim(coalesce(e->>'stickerStatus', ''))) IN ('WRITTEN_OFF', 'RETIRED', 'WITHDRAWN')
       )::int AS "blockedCount"
     FROM wms_code_lists cl
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json ELSE '[]'::jsonb END
     ) AS e
     WHERE cl.site_id = $1
       AND cl.list_type = 'receiving_scan_event'
       AND trim(coalesce(e->>'documentId', '')) <> ''
     GROUP BY 1`,
    [siteId]
  );
  return r.rows;
}

export async function listCodeListsForSite(
  client: PoolClient,
  siteId: number,
  options?: { limit?: number }
) {
  const limit = Math.max(Math.min(Number(options?.limit ?? 100), 300), 1);
  const r = await client.query(
    `SELECT
       code_list_id::text AS "codeListId",
       request_id::text AS "requestId",
       device_uid AS "deviceUid",
       list_type AS "listType",
       pallet_code AS "palletCode",
       reason_code AS "reasonCode",
       created_at AS "createdAt",
       entries_json AS "entries"
     FROM wms_code_lists
     WHERE site_id = $1
     ORDER BY created_at DESC, code_list_id DESC
     LIMIT $2`,
    [siteId, limit]
  );
  return { lists: r.rows };
}

export async function getCodeListById(
  client: PoolClient,
  siteId: number,
  codeListId: string
) {
  const r = await client.query(
    `SELECT
       code_list_id::text AS "codeListId",
       request_id::text AS "requestId",
       device_uid AS "deviceUid",
       list_type AS "listType",
       pallet_code AS "palletCode",
       reason_code AS "reasonCode",
       created_at AS "createdAt",
       entries_json AS "entries"
     FROM wms_code_lists
     WHERE site_id = $1 AND code_list_id = $2::bigint
     LIMIT 1`,
    [siteId, codeListId]
  );
  return r.rows[0] ?? null;
}

function normalizeCodeListEntries(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return [...raw];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return [...parsed];
    } catch {
      /* ignore */
    }
  }
  return [];
}

export function parseReceivingScanEventId(id: string): { codeListId: string; entryIndex: number } {
  const s = id.trim();
  const colon = s.lastIndexOf(":");
  if (colon <= 0) {
    throw new WmsHttpError(400, "invalid scan event id", "bad_scan_event_id");
  }
  const codeListId = s.slice(0, colon).trim();
  const index1 = Number(s.slice(colon + 1));
  if (!codeListId || !Number.isFinite(index1) || index1 < 1) {
    throw new WmsHttpError(400, "invalid scan event id", "bad_scan_event_id");
  }
  return { codeListId, entryIndex: index1 - 1 };
}

export async function deleteReceivingScanEvent(
  client: PoolClient,
  siteId: number,
  scanEventId: string
) {
  const { codeListId, entryIndex } = parseReceivingScanEventId(scanEventId);
  const current = await getCodeListById(client, siteId, codeListId);
  if (!current) {
    throw new WmsHttpError(404, "scan event not found", "scan_event_not_found");
  }
  if (String((current as { listType?: string }).listType ?? "") !== "receiving_scan_event") {
    throw new WmsHttpError(400, "not a receiving scan event", "bad_list_type");
  }
  const entries = normalizeCodeListEntries((current as { entries?: unknown }).entries);
  if (entryIndex < 0 || entryIndex >= entries.length) {
    throw new WmsHttpError(404, "scan entry not found", "scan_entry_not_found");
  }
  if (entries.length === 1) {
    await client.query(
      `DELETE FROM wms_code_lists
       WHERE site_id = $1 AND code_list_id = $2::bigint`,
      [siteId, codeListId]
    );
  } else {
    entries.splice(entryIndex, 1);
    await client.query(
      `UPDATE wms_code_lists
       SET entries_json = $3::jsonb
       WHERE site_id = $1 AND code_list_id = $2::bigint`,
      [siteId, codeListId, JSON.stringify(entries)]
    );
  }
  return { ok: true as const, deletedId: scanEventId };
}

async function findLatestReceivingScanEvent(
  client: PoolClient,
  siteId: number,
  documentId: string,
  code: string
): Promise<{ codeListId: string; entryIndex: number } | null> {
  const doc = documentId.trim();
  const normalizedCode = code.trim();
  if (!doc || !normalizedCode) return null;
  const r = await client.query(
    `SELECT code_list_id::text AS "codeListId", entries_json AS entries
     FROM wms_code_lists
     WHERE site_id = $1 AND list_type = 'receiving_scan_event'
     ORDER BY created_at DESC
     LIMIT 500`,
    [siteId]
  );
  for (const row of r.rows) {
    const entries = Array.isArray((row as { entries?: unknown[] }).entries)
      ? ((row as { entries: unknown[] }).entries)
      : [];
    for (let i = 0; i < entries.length; i += 1) {
      const e = (entries[i] ?? {}) as Record<string, unknown>;
      if (
        String(e.documentId ?? "").trim() === doc &&
        String(e.code ?? "").trim() === normalizedCode
      ) {
        return { codeListId: String((row as { codeListId: string }).codeListId), entryIndex: i };
      }
    }
  }
  return null;
}

export async function updateReceivingScanEventQty(
  client: PoolClient,
  siteId: number,
  scanEventId: string,
  qty: number
) {
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new WmsHttpError(400, "qty must be a positive number", "bad_qty");
  }
  const { codeListId, entryIndex } = parseReceivingScanEventId(scanEventId);
  const current = await getCodeListById(client, siteId, codeListId);
  if (!current) {
    throw new WmsHttpError(404, "scan event not found", "scan_event_not_found");
  }
  if (String((current as { listType?: string }).listType ?? "") !== "receiving_scan_event") {
    throw new WmsHttpError(400, "not a receiving scan event", "bad_list_type");
  }
  const entries = normalizeCodeListEntries((current as { entries?: unknown }).entries);
  if (entryIndex < 0 || entryIndex >= entries.length) {
    throw new WmsHttpError(404, "scan entry not found", "scan_entry_not_found");
  }
  const entry = (entries[entryIndex] ?? {}) as Record<string, unknown>;
  entries[entryIndex] = { ...entry, qty };
  await client.query(
    `UPDATE wms_code_lists
     SET entries_json = $3::jsonb
     WHERE site_id = $1 AND code_list_id = $2::bigint`,
    [siteId, codeListId, JSON.stringify(entries)]
  );
  return { ok: true as const, scanEventId, qty };
}

export async function syncReceivingSessionQuantities(
  client: PoolClient,
  siteId: number,
  documentId: string,
  lines: Array<{ code: string; qty: number; scanEventId?: string | null }>
) {
  const doc = documentId.trim();
  if (!doc) {
    throw new WmsHttpError(400, "documentId is required", "bad_document_id");
  }
  const updatedIds: string[] = [];
  for (const line of lines) {
    const code = String(line.code ?? "").trim();
    const qty = Number(line.qty);
    if (!code || !Number.isFinite(qty) || qty <= 0) continue;

    const scanEventId = String(line.scanEventId ?? "").trim();
    if (scanEventId) {
      try {
        await updateReceivingScanEventQty(client, siteId, scanEventId, qty);
        updatedIds.push(scanEventId);
        continue;
      } catch (error) {
        if (!(error instanceof WmsHttpError) || error.status !== 404) {
          throw error;
        }
      }
    }

    const match = await findLatestReceivingScanEvent(client, siteId, doc, code);
    if (!match) continue;
    const resolvedId = `${match.codeListId}:${match.entryIndex + 1}`;
    await updateReceivingScanEventQty(client, siteId, resolvedId, qty);
    updatedIds.push(resolvedId);
  }
  return { ok: true as const, updatedCount: updatedIds.length, updatedIds };
}

export async function updateCodeListEntryComment(
  client: PoolClient,
  siteId: number,
  codeListId: string,
  comment: string | null
) {
  const current = await getCodeListById(client, siteId, codeListId);
  if (!current) {
    throw new WmsHttpError(404, "code list not found", "code_list_not_found");
  }
  const entries = normalizeCodeListEntries((current as { entries?: unknown }).entries);
  if (entries.length === 0) {
    throw new WmsHttpError(400, "entries are empty", "bad_entries");
  }
  const first = (entries[0] ?? {}) as Record<string, unknown>;
  entries[0] = {
    ...first,
    comment: comment && comment.trim() ? comment.trim() : null,
  };
  await client.query(
    `UPDATE wms_code_lists
     SET entries_json = $3::jsonb
     WHERE site_id = $1 AND code_list_id = $2::bigint`,
    [siteId, codeListId, JSON.stringify(entries)]
  );
  return { ok: true as const };
}

