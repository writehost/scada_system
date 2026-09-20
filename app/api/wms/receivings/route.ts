import { NextResponse } from "next/server";
import {
  getSiteId,
  resolveItemByCodeOrBarcode,
  resolveLocation,
} from "@/lib/wms/resolve";
import { tryGetPool } from "@/lib/wms/pool";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { fetchBalanceSnapshot } from "@/lib/wms/query";
import { parseRequestId } from "@/lib/wms/uuid";
import { WmsHttpError } from "@/lib/wms/errors";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import { ensureWmsLot } from "@/lib/wms/documents";
import { applyStockReceipt } from "@/lib/wms/stock-ledger";
import { WMS_PERMISSION, requireWmsPermission } from "@/lib/wms/permissions";
import type { PoolClient } from "pg";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function trimStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function parseOptionalNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseOptionalIsoDate(v: unknown): string | null {
  const t = trimStr(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type ReceivingBody = {
  requestId?: string;
  siteCode?: string;
  itemCode?: string;
  targetLocationCode?: string;
  qty?: number;
  batchLabel?: string | null;
  externalRef1c?: string | null;
  receiptAt?: string | null;
  erpItem1cId?: string | null;
  erpDocumentLineQty?: number | string | null;
  erpDocumentExpiryDate?: string | null;
  confirmedMatch1c?: boolean;
  lotExpiryAt?: string | null;
  receiptUnitVolumeL?: number | string | null;
  receiptDimLengthMm?: number | string | null;
  receiptDimWidthMm?: number | string | null;
  receiptDimHeightMm?: number | string | null;
};

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: ReceivingBody;
  try {
    body = (await req.json()) as ReceivingBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(body.requestId);
  const siteCode = typeof body.siteCode === "string" ? body.siteCode : "";
  const itemCode = typeof body.itemCode === "string" ? body.itemCode : "";
  const targetLocationCode =
    typeof body.targetLocationCode === "string" ? body.targetLocationCode : "";
  const qty = Number(body.qty);
  const batchLabel =
    typeof body.batchLabel === "string" && body.batchLabel.trim()
      ? body.batchLabel.trim()
      : null;

  const externalRef1c = trimStr(body.externalRef1c);
  const receiptAtIso = parseOptionalIsoDate(body.receiptAt);
  const erpItem1cId = trimStr(body.erpItem1cId);
  const erpDocumentLineQty = parseOptionalNumber(body.erpDocumentLineQty);
  const erpDocumentExpiryDate = trimStr(body.erpDocumentExpiryDate);
  const confirmedMatch1c = body.confirmedMatch1c === true;
  const lotExpiryIso = parseOptionalIsoDate(body.lotExpiryAt);
  const receiptUnitVolumeL = parseOptionalNumber(body.receiptUnitVolumeL);
  const receiptDimL = parseOptionalNumber(body.receiptDimLengthMm);
  const receiptDimW = parseOptionalNumber(body.receiptDimWidthMm);
  const receiptDimH = parseOptionalNumber(body.receiptDimHeightMm);

  const hasErpHint =
    Boolean(erpItem1cId) ||
    (erpDocumentLineQty != null && erpDocumentLineQty > 0) ||
    Boolean(erpDocumentExpiryDate);

  if (hasErpHint && !confirmedMatch1c) {
    return NextResponse.json(
      {
        error:
          "Указаны данные из документа 1С — отметьте подтверждение соответствия факта строке документа",
        code: "erp_match_required",
        disposition: "failed",
      },
      { status: 400 }
    );
  }

  if (!requestId) {
    return NextResponse.json({ error: "requestId must be a UUID" }, { status: 400 });
  }
  if (!siteCode.trim() || !itemCode.trim()) {
    return NextResponse.json(
      { error: "siteCode and itemCode are required" },
      { status: 400 }
    );
  }
  if (!targetLocationCode.trim()) {
    return NextResponse.json(
      { error: "targetLocationCode is required" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "qty must be a positive number" }, { status: 400 });
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
      "receiving",
      body,
      (client) =>
        receivingWork(client, siteId, {
          actorUserId: actorGate.actor.userId,
          actorLogin: actorGate.actor.session?.login,
          requestId,
          itemCode,
          targetLocationCode,
          qty,
          batchLabel,
          externalRef1c,
          receiptAtIso,
          erpItem1cId,
          erpDocumentLineQty,
          erpDocumentExpiryDate,
          confirmedMatch1c,
          lotExpiryIso,
          receiptUnitVolumeL,
          receiptDimL,
          receiptDimW,
          receiptDimH,
        })
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json(
        { error: e.message, code: e.code, disposition: "failed" },
        { status: e.status }
      );
    }
    console.error(e);
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e), disposition: "failed" },
      { status: 500 }
    );
  }
}

async function receivingWork(
  client: PoolClient,
  siteId: number,
  p: {
    actorUserId?: string | null;
    actorLogin?: string | null;
    requestId: string;
    itemCode: string;
    targetLocationCode: string;
    qty: number;
    batchLabel: string | null;
    externalRef1c: string | null;
    receiptAtIso: string | null;
    erpItem1cId: string | null;
    erpDocumentLineQty: number | null;
    erpDocumentExpiryDate: string | null;
    confirmedMatch1c: boolean;
    lotExpiryIso: string | null;
    receiptUnitVolumeL: number | null;
    receiptDimL: number | null;
    receiptDimW: number | null;
    receiptDimH: number | null;
  }
) {
  const item = await resolveItemByCodeOrBarcode(client, siteId, p.itemCode);
  if (!item) {
    throw new WmsHttpError(404, "item not found", "item_not_found");
  }
  const loc = await resolveLocation(client, siteId, p.targetLocationCode);
  if (!loc) {
    throw new WmsHttpError(404, "location not found", "location_not_found");
  }
  if (loc.location_status_id === 2) {
    throw new WmsHttpError(409, "location is blocked", "location_blocked");
  }

  const inactive = await client.query<{ is_active: boolean }>(
    `SELECT COALESCE(is_active, TRUE) AS is_active FROM wms_items WHERE item_id = $1::bigint`,
    [item.item_id]
  );
  if (inactive.rows[0] && inactive.rows[0].is_active === false) {
    throw new WmsHttpError(409, "номенклатура неактивна", "item_inactive");
  }

  await requireWmsPermission(client, p.actorUserId, WMS_PERMISSION.stockReceive, p.actorLogin);

  let lotId: string | null = null;
  const lotCode = p.batchLabel?.trim() || null;
  if (lotCode) {
    lotId = await ensureWmsLot(
      client,
      siteId,
      item.item_id,
      lotCode,
      lotCode,
      undefined,
      undefined,
      p.lotExpiryIso ?? undefined
    );
  }

  const docPayload: Record<string, unknown> = {
    ...(p.externalRef1c ? { externalRef1c: p.externalRef1c } : {}),
    ...(p.receiptAtIso ? { receiptAtIso: p.receiptAtIso } : {}),
    receiving: {
      wmsItemCode: p.itemCode.trim(),
      erp: {
        item1cId: p.erpItem1cId,
        documentLineQty: p.erpDocumentLineQty,
        documentExpiryDate: p.erpDocumentExpiryDate,
      },
      match: {
        confirmedMatch1c: p.confirmedMatch1c,
      },
      vgh: {
        unitVolumeL: p.receiptUnitVolumeL,
        dimsMm:
          p.receiptDimL != null && p.receiptDimW != null && p.receiptDimH != null
            ? { l: p.receiptDimL, w: p.receiptDimW, h: p.receiptDimH }
            : null,
        source: "manual_receipt",
      },
      ...(p.lotExpiryIso && !p.batchLabel
        ? { factExpiryIsoWithoutBatch: p.lotExpiryIso }
        : {}),
    },
  };

  const lineTaskPayload: Record<string, unknown> = {
    receivingLine: docPayload.receiving,
  };

  const doc = await client.query<{ document_id: string }>(
    `INSERT INTO wms_documents (
       site_id, document_type_id, document_status_id, request_id,
       target_location_id, applied_at, payload_json
     ) VALUES ($1, 1, 3, $2::uuid, $3::bigint, now(), $4::jsonb)
     RETURNING document_id::text`,
    [siteId, p.requestId, loc.location_id, JSON.stringify(docPayload)]
  );
  const documentId = doc.rows[0].document_id;

  const line = await client.query<{ document_line_id: string }>(
    `INSERT INTO wms_document_lines (
       document_id, line_no, item_id, target_location_id, requested_qty, confirmed_qty, lot_code, task_payload
     ) VALUES ($1::bigint, 1, $2::bigint, $3::bigint, $4, $4, $5, $6::jsonb)
     RETURNING document_line_id::text`,
    [documentId, item.item_id, loc.location_id, p.qty, p.batchLabel, JSON.stringify(lineTaskPayload)]
  );
  const documentLineId = line.rows[0].document_line_id;

  await applyStockReceipt(client, {
    siteId,
    itemId: item.item_id,
    toLocationId: loc.location_id,
    qty: p.qty,
    lotId,
    lotCode,
    lotExpiryAt: p.lotExpiryIso,
    documentId,
    documentLineId,
    requestId: p.requestId,
    payload: { receiving: { documentPayload: docPayload.receiving } },
  });

  const stock = await fetchBalanceSnapshot(
    client,
    siteId,
    loc.location_id,
    item.item_id
  );

  return { documentId, documentType: "receiving", stock };
}
