import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { tryGetPool } from "@/lib/wms/pool";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { parseRequestId } from "@/lib/wms/uuid";
import { getSiteId, resolveItemByCodeOrBarcode, resolveLocation } from "@/lib/wms/resolve";
import { fetchBalanceSnapshot } from "@/lib/wms/query";
import { ensureWmsLot } from "@/lib/wms/documents";
import { WmsHttpError } from "@/lib/wms/errors";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualReceivingLineBody = {
  itemCode?: string;
  qty?: number | string;
  batchLabel?: string | null;
  emissionAt?: string | null;
  lotExpiryAt?: string | null;
  markingCode?: string | null;
  comment?: string | null;
};

type ManualReceivingBody = {
  requestId?: string;
  siteCode?: string;
  targetLocationCode?: string;
  documentNo?: string | null;
  comment?: string | null;
  groupCode?: string | null;
  groupName?: string | null;
  receiptAt?: string | null;
  lines?: ManualReceivingLineBody[];
};

function trimStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function parseQty(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseOptionalIsoDate(v: unknown): string | null {
  const t = trimStr(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function makeLotCode(itemCode: string, emissionAt: string | null, batchLabel: string | null): string | null {
  if (batchLabel) return batchLabel;
  if (!emissionAt) return null;
  const day = emissionAt.slice(0, 10).replace(/-/g, "");
  const safeItem = itemCode.trim().replace(/[^A-Za-zА-Яа-я0-9_-]+/g, "-").slice(0, 40);
  return `RCV-${day}-${safeItem}`;
}

async function inferLotExpiryAt(
  client: PoolClient,
  siteId: number,
  itemId: string,
  emissionAt: string | null,
  explicitExpiryAt: string | null
): Promise<string | null> {
  if (explicitExpiryAt) return explicitExpiryAt;
  if (!emissionAt) return null;
  const item = await client.query<{ shelf_life_days: number | null }>(
    `SELECT shelf_life_days
     FROM wms_items
     WHERE site_id = $1 AND item_id = $2::bigint`,
    [siteId, itemId]
  );
  const shelfLifeDays = Number(item.rows[0]?.shelf_life_days ?? 365);
  const safeDays = Number.isFinite(shelfLifeDays) && shelfLifeDays > 0 ? Math.trunc(shelfLifeDays) : 365;
  const d = new Date(emissionAt);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + safeDays);
  return d.toISOString();
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: ManualReceivingBody;
  try {
    body = (await req.json()) as ManualReceivingBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(body.requestId);
  const siteCode = trimStr(body.siteCode) ?? "";
  const targetLocationCode = trimStr(body.targetLocationCode) ?? "";
  const lines = Array.isArray(body.lines) ? body.lines : [];

  if (!requestId) {
    return NextResponse.json({ error: "requestId must be a UUID" }, { status: 400 });
  }
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!targetLocationCode) {
    return NextResponse.json({ error: "targetLocationCode is required" }, { status: 400 });
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "lines are required" }, { status: 400 });
  }
  if (lines.length > 200) {
    return NextResponse.json({ error: "too many lines, max 200" }, { status: 400 });
  }

  let normalizedLines: Array<{
    itemCode: string;
    qty: number;
    batchLabel: string | null;
    emissionAt: string | null;
    lotExpiryAt: string | null;
    markingCode: string | null;
    comment: string | null;
    lotCode: string | null;
  }>;
  try {
    normalizedLines = lines.map((line, idx) => {
      const itemCode = trimStr(line.itemCode);
      const qty = parseQty(line.qty);
      if (!itemCode) {
        throw new WmsHttpError(400, `line ${idx + 1}: itemCode is required`, "item_required");
      }
      if (qty == null) {
        throw new WmsHttpError(400, `line ${idx + 1}: qty must be positive`, "qty_invalid");
      }
      const emissionAt = parseOptionalIsoDate(line.emissionAt);
      const lotExpiryAt = parseOptionalIsoDate(line.lotExpiryAt);
      const batchLabel = trimStr(line.batchLabel);
      return {
        itemCode,
        qty,
        batchLabel,
        emissionAt,
        lotExpiryAt,
        markingCode: trimStr(line.markingCode),
        comment: trimStr(line.comment),
        lotCode: makeLotCode(itemCode, emissionAt, batchLabel),
      };
    });
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json(
        { error: error.message, code: error.code, disposition: "failed" },
        { status: error.status }
      );
    }
    throw error;
  }

  const probe = await pool.connect();
  let siteId: number;
  try {
    const sid = await getSiteId(probe, siteCode);
    if (sid == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    siteId = sid;
  } finally {
    probe.release();
  }

  try {
    const result = await runIdempotentWrite(
      pool,
      requestId,
      siteId,
      "receiving_manual_document",
      body,
      (client) =>
        manualReceivingWork(client, siteId, {
          requestId,
          targetLocationCode,
          documentNo: trimStr(body.documentNo),
          comment: trimStr(body.comment),
          groupCode: trimStr(body.groupCode),
          groupName: trimStr(body.groupName),
          receiptAtIso: parseOptionalIsoDate(body.receiptAt),
          lines: normalizedLines,
        })
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json(
        { error: error.message, code: error.code, disposition: "failed" },
        { status: error.status }
      );
    }
    console.error("[POST /api/wms/receivings/manual-document]", error);
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(error), disposition: "failed" },
      { status: 500 }
    );
  }
}

async function manualReceivingWork(
  client: PoolClient,
  siteId: number,
  p: {
    requestId: string;
    targetLocationCode: string;
    documentNo: string | null;
    comment: string | null;
    groupCode: string | null;
    groupName: string | null;
    receiptAtIso: string | null;
    lines: Array<{
      itemCode: string;
      qty: number;
      batchLabel: string | null;
      emissionAt: string | null;
      lotExpiryAt: string | null;
      markingCode: string | null;
      comment: string | null;
      lotCode: string | null;
    }>;
  }
) {
  const loc = await resolveLocation(client, siteId, p.targetLocationCode);
  if (!loc) {
    throw new WmsHttpError(404, "location not found", "location_not_found");
  }
  if (loc.location_status_id === 2) {
    throw new WmsHttpError(409, "location is blocked", "location_blocked");
  }

  const docPayload = {
    source: "manual_receiving",
    receiptAtIso: p.receiptAtIso,
    group: {
      code: p.groupCode,
      name: p.groupName,
    },
  };

  const doc = await client.query<{ document_id: string }>(
    `INSERT INTO wms_documents (
       site_id, document_type_id, document_status_id, request_id,
       document_no, target_location_id, comment, receipt_at, applied_at, payload_json
     ) VALUES ($1, 1, 3, $2::uuid, $3, $4::bigint, $5, $6, now(), $7::jsonb)
     RETURNING document_id::text`,
    [
      siteId,
      p.requestId,
      p.documentNo,
      loc.location_id,
      p.comment,
      p.receiptAtIso ? new Date(p.receiptAtIso) : null,
      JSON.stringify(docPayload),
    ]
  );
  const documentId = doc.rows[0]!.document_id;

  const snapshots: unknown[] = [];
  let totalQty = 0;

  for (let i = 0; i < p.lines.length; i += 1) {
    const line = p.lines[i]!;
    const item = await resolveItemByCodeOrBarcode(client, siteId, line.itemCode);
    if (!item) {
      throw new WmsHttpError(404, `item not found: ${line.itemCode}`, "item_not_found");
    }
    const effectiveLotExpiryAt = await inferLotExpiryAt(
      client,
      siteId,
      item.item_id,
      line.emissionAt,
      line.lotExpiryAt
    );

    const up = await client.query<{ balance_id: string }>(
      `INSERT INTO wms_stock_balances (site_id, location_id, item_id, available_qty, accuracy_status_id)
       VALUES ($1, $2::bigint, $3::bigint, $4, 1)
       ON CONFLICT (site_id, location_id, item_id)
       DO UPDATE SET
         available_qty = wms_stock_balances.available_qty + EXCLUDED.available_qty,
         updated_at = now()
       RETURNING balance_id::text`,
      [siteId, loc.location_id, item.item_id, line.qty]
    );
    const balanceId = up.rows[0]?.balance_id;
    if (!balanceId) {
      throw new WmsHttpError(500, "balance missing after upsert", "balance_missing");
    }

    if (line.lotCode) {
      const lotId = await ensureWmsLot(
        client,
        siteId,
        item.item_id,
        line.lotCode,
        line.batchLabel ?? line.lotCode,
        line.emissionAt ?? undefined,
        undefined,
        effectiveLotExpiryAt ?? undefined
      );
      if (!lotId) {
        throw new WmsHttpError(500, "lot missing after upsert", "lot_missing");
      }
      await client.query(
        `INSERT INTO wms_stock_lots (balance_id, lot_id, lot_code, batch_label, available_qty, expiry_at, received_at)
         VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6, $7)
         ON CONFLICT (balance_id, lot_code)
         DO UPDATE SET
           lot_id = COALESCE(wms_stock_lots.lot_id, EXCLUDED.lot_id),
           batch_label = COALESCE(EXCLUDED.batch_label, wms_stock_lots.batch_label),
           available_qty = wms_stock_lots.available_qty + EXCLUDED.available_qty,
           expiry_at = COALESCE(EXCLUDED.expiry_at, wms_stock_lots.expiry_at),
           received_at = COALESCE(wms_stock_lots.received_at, EXCLUDED.received_at),
           updated_at = now()`,
        [
          balanceId,
          lotId,
          line.lotCode,
          line.batchLabel ?? line.lotCode,
          line.qty,
          effectiveLotExpiryAt ? new Date(effectiveLotExpiryAt) : null,
          p.receiptAtIso ? new Date(p.receiptAtIso) : new Date(),
        ]
      );
    }

    const linePayload = {
      source: "manual_receiving",
      emissionAtIso: line.emissionAt,
      markingCode: line.markingCode,
      lotExpiryAtIso: effectiveLotExpiryAt,
    };
    const docLine = await client.query<{ document_line_id: string }>(
      `INSERT INTO wms_document_lines (
         document_id, line_no, item_id, target_location_id,
         requested_qty, confirmed_qty, lot_id, lot_code, comment, task_payload
       ) VALUES (
         $1::bigint, $2, $3::bigint, $4::bigint,
         $5, $5,
         (SELECT lot_id FROM wms_lots WHERE site_id = $9 AND item_id = $3::bigint AND lot_code = $6 LIMIT 1),
         $6, $7, $8::jsonb
       )
       RETURNING document_line_id::text`,
      [
        documentId,
        i + 1,
        item.item_id,
        loc.location_id,
        line.qty,
        line.lotCode,
        line.comment,
        JSON.stringify({ receivingLine: linePayload }),
        siteId,
      ]
    );
    const documentLineId = docLine.rows[0]!.document_line_id;

    await client.query(
      `INSERT INTO wms_stock_movements (
         site_id, movement_type_id, document_id, document_line_id, item_id,
         to_location_id, to_bucket_id, qty, request_id, payload_json
       ) VALUES ($1, 1, $2::bigint, $3::bigint, $4::bigint, $5::bigint, 1, $6, $7::uuid, $8::jsonb)`,
      [
        siteId,
        documentId,
        documentLineId,
        item.item_id,
        loc.location_id,
        line.qty,
        p.requestId,
        JSON.stringify({ receiving: linePayload }),
      ]
    );

    totalQty += line.qty;
    snapshots.push(await fetchBalanceSnapshot(client, siteId, loc.location_id, item.item_id));
  }

  return {
    documentId,
    documentType: "receiving",
    lineCount: p.lines.length,
    totalQty,
    stock: snapshots,
    disposition: "created",
  };
}
