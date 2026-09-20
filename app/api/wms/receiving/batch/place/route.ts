import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId, resolveItemByCodeOrBarcode, resolveLocation } from "@/lib/wms/resolve";
import {
  findReceivingBatch,
  resolveReceivingBatchLocation,
} from "@/lib/wms/receiving-batches";
import { buildReceivingLotCode, emissionDayKey } from "@/lib/wms/issue-stock";
import { applyStockTransfer } from "@/lib/wms/stock-ledger";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { parseRequestId } from "@/lib/wms/uuid";
import { WmsHttpError } from "@/lib/wms/errors";
import { logWmsOperationEvent } from "@/lib/wms/operation-events";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlaceBatchBody = {
  requestId?: unknown;
  siteCode?: unknown;
  batchCode?: unknown;
  targetLocationCode?: unknown;
  deviceUid?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function virtualPath(client: PoolClient, locationId: string): Promise<string | null> {
  const result = await client.query<{ virtualPath: string | null }>(
    `WITH RECURSIVE virtual_path AS (
       SELECT n.node_id, n.parent_node_id, n.label, 0 AS depth
       FROM wms_virtual_links vl
       JOIN wms_virtual_nodes n ON n.node_id = vl.node_id
       WHERE vl.location_id = $1::bigint
       UNION ALL
       SELECT p.node_id, p.parent_node_id, p.label, vp.depth + 1
       FROM wms_virtual_nodes p
       JOIN virtual_path vp ON vp.parent_node_id = p.node_id
     )
     SELECT string_agg(label, ' / ' ORDER BY depth DESC) AS "virtualPath"
     FROM virtual_path`,
    [locationId]
  );
  return result.rows[0]?.virtualPath ?? null;
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  let body: PlaceBatchBody;
  try {
    body = (await req.json()) as PlaceBatchBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(text(body.requestId));
  const siteCode = text(body.siteCode);
  const batchCode = text(body.batchCode);
  const targetLocationCode = text(body.targetLocationCode);
  const deviceUid = text(body.deviceUid);
  if (!requestId || !siteCode || !batchCode || !targetLocationCode) {
    return NextResponse.json(
      { error: "requestId, siteCode, batchCode and targetLocationCode are required" },
      { status: 400 }
    );
  }

  const probe = await pool.connect();
  let siteId: number;
  try {
    const resolved = await getSiteId(probe, siteCode);
    if (resolved == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    siteId = resolved;
  } finally {
    probe.release();
  }

  try {
    const result = await runIdempotentWrite(
      pool,
      requestId,
      siteId,
      "batch_putaway",
      body,
      async (client) => {
        const batch = await findReceivingBatch(client, siteId, batchCode);
        if (!batch || !batch.itemCode) {
          throw new WmsHttpError(404, "batch sticker not found", "batch_not_found");
        }
        const qty = Number(batch.qty);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new WmsHttpError(409, "batch sticker has no quantity", "batch_qty_missing");
        }
        const sourceCode = await resolveReceivingBatchLocation(client, siteId, batch);
        if (!sourceCode) {
          throw new WmsHttpError(
            409,
            "Не удалось определить ячейку партии по остатку",
            "batch_location_missing"
          );
        }

        const item = await resolveItemByCodeOrBarcode(client, siteId, batch.itemCode);
        const source = await resolveLocation(client, siteId, sourceCode);
        const target = await resolveLocation(client, siteId, targetLocationCode);
        if (!item || !source || !target) {
          throw new WmsHttpError(404, "item or location not found", "reference_not_found");
        }
        if (target.location_status_id === 2) {
          throw new WmsHttpError(409, "target location is blocked", "location_blocked");
        }
        if (source.location_id === target.location_id) {
          return {
            batchCode,
            itemCode: batch.itemCode,
            itemName: batch.itemName,
            qty,
            lotCode: buildReceivingLotCode(batch.itemCode, emissionDayKey(batch.emissionAtIso)),
            sourceLocationCode: source.location_code,
            targetLocationCode: target.location_code,
            virtualPath: await virtualPath(client, target.location_id),
            alreadyPlaced: true,
          };
        }

        const lotCode = buildReceivingLotCode(
          batch.itemCode,
          emissionDayKey(batch.emissionAtIso)
        );
        const lot = await client.query<{ lotId: string }>(
          `SELECT lot_id::text AS "lotId"
           FROM wms_lots
           WHERE site_id = $1 AND item_id = $2::bigint AND lot_code = $3
           LIMIT 1`,
          [siteId, item.item_id, lotCode]
        );
        const lotId = lot.rows[0]?.lotId;
        if (!lotId) {
          throw new WmsHttpError(404, "lot not found", "lot_not_found");
        }

        const document = await client.query<{ documentId: string }>(
          `INSERT INTO wms_documents (
             site_id, document_type_id, document_status_id, request_id,
             source_location_id, target_location_id, comment, payload_json, applied_at
           ) VALUES ($1, 5, 3, $2::uuid, $3::bigint, $4::bigint, $5, $6::jsonb, now())
           RETURNING document_id::text AS "documentId"`,
          [
            siteId,
            requestId,
            source.location_id,
            target.location_id,
            `Размещение партии ${batchCode}`,
            JSON.stringify({ batchCode, deviceUid }),
          ]
        );
        const documentId = document.rows[0].documentId;
        const line = await client.query<{ documentLineId: string }>(
          `INSERT INTO wms_document_lines (
             document_id, line_no, item_id, source_location_id, target_location_id,
             requested_qty, confirmed_qty, lot_id, lot_code, comment
           ) VALUES ($1::bigint, 1, $2::bigint, $3::bigint, $4::bigint, $5, $5, $6::bigint, $7, $8)
           RETURNING document_line_id::text AS "documentLineId"`,
          [
            documentId,
            item.item_id,
            source.location_id,
            target.location_id,
            qty,
            lotId,
            lotCode,
            `Код объёма: ${batchCode}`,
          ]
        );

        await applyStockTransfer(client, {
          siteId,
          itemId: item.item_id,
          fromLocationId: source.location_id,
          toLocationId: target.location_id,
          qty,
          lotId,
          lotCode,
          documentId,
          documentLineId: line.rows[0].documentLineId,
          requestId,
          eventType: "stock.putaway",
          payload: { batchCode, deviceUid },
        });
        await logWmsOperationEvent(client, {
          siteId,
          eventType: "batch.putaway",
          deviceUid,
          documentId,
          itemId: item.item_id,
          locationId: target.location_id,
          codeValue: batchCode,
          payload: {
            qty,
            lotCode,
            sourceLocationCode: source.location_code,
            targetLocationCode: target.location_code,
          },
        });

        return {
          documentId,
          batchCode,
          itemCode: batch.itemCode,
          itemName: batch.itemName,
          qty,
          lotCode,
          sourceLocationCode: source.location_code,
          targetLocationCode: target.location_code,
          virtualPath: await virtualPath(client, target.location_id),
          alreadyPlaced: false,
        };
      }
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error("[POST /api/wms/receiving/batch/place]", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
