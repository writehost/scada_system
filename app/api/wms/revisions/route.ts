import { NextResponse } from "next/server";
import { getSiteId, resolveItemByCodeOrBarcode, resolveLocation } from "@/lib/wms/resolve";
import { tryGetPool } from "@/lib/wms/pool";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { fetchBalanceSnapshot } from "@/lib/wms/query";
import { parseRequestId } from "@/lib/wms/uuid";
import { WmsHttpError } from "@/lib/wms/errors";
import type { PoolClient } from "pg";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RevisionLine = { itemCode: string; actualQty: number };

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

  let body: {
    requestId?: string;
    siteCode?: string;
    locationCode?: string;
    checkedBy?: string;
    comment?: string | null;
    lines?: RevisionLine[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(body.requestId);
  const siteCode = typeof body.siteCode === "string" ? body.siteCode : "";
  const locationCode = typeof body.locationCode === "string" ? body.locationCode : "";
  const checkedBy =
    typeof body.checkedBy === "string" ? body.checkedBy.trim() : "";
  const comment =
    typeof body.comment === "string" ? body.comment.trim() : null;
  const lines = Array.isArray(body.lines) ? body.lines : null;

  if (!requestId) {
    return NextResponse.json({ error: "requestId must be a UUID" }, { status: 400 });
  }
  if (!siteCode.trim() || !locationCode.trim()) {
    return NextResponse.json(
      { error: "siteCode and locationCode are required" },
      { status: 400 }
    );
  }
  if (!checkedBy) {
    return NextResponse.json({ error: "checkedBy is required" }, { status: 400 });
  }
  if (!lines || lines.length === 0) {
    return NextResponse.json({ error: "lines must be a non-empty array" }, { status: 400 });
  }

  for (const ln of lines) {
    if (!ln || typeof ln.itemCode !== "string" || !ln.itemCode.trim()) {
      return NextResponse.json({ error: "each line needs itemCode" }, { status: 400 });
    }
    if (!Number.isFinite(ln.actualQty)) {
      return NextResponse.json({ error: "each line needs numeric actualQty" }, { status: 400 });
    }
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
      "revision",
      body,
      (client) =>
        revisionWork(client, siteId, {
          requestId,
          locationCode,
          checkedBy,
          comment,
          lines: lines.map((l) => ({
            itemCode: l.itemCode.trim(),
            actualQty: Number(l.actualQty),
          })),
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
      { error: "internal error", disposition: "failed" },
      { status: 500 }
    );
  }
}

async function revisionWork(
  client: PoolClient,
  siteId: number,
  p: {
    requestId: string;
    locationCode: string;
    checkedBy: string;
    comment: string | null;
    lines: { itemCode: string; actualQty: number }[];
  }
) {
  const loc = await resolveLocation(client, siteId, p.locationCode);
  if (!loc) {
    throw new WmsHttpError(404, "location not found", "location_not_found");
  }
  if (loc.location_status_id === 2) {
    throw new WmsHttpError(409, "location is blocked", "location_blocked");
  }

  const resolved: {
    item: { item_id: string; item_code: string; name: string };
    actualQty: number;
  }[] = [];
  for (const line of p.lines) {
    const item = await resolveItemByCodeOrBarcode(client, siteId, line.itemCode);
    if (!item) {
      throw new WmsHttpError(404, `item not found: ${line.itemCode}`, "item_not_found");
    }
    resolved.push({ item, actualQty: line.actualQty });
  }

  resolved.sort((a, b) => a.item.item_id.localeCompare(b.item.item_id));
  for (const r of resolved) {
    await client.query(
      `SELECT 1 FROM wms_stock_balances
       WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint
       FOR UPDATE`,
      [siteId, loc.location_id, r.item.item_id]
    );
  }

  let accountedTotal = 0;
  let actualTotal = 0;
  let varianceTotal = 0;
  const computed: {
    item: (typeof resolved)[0]["item"];
    accounted: number;
    actual: number;
    variance: number;
  }[] = [];

  for (const r of resolved) {
    const bal = await client.query<{ available_qty: string }>(
      `SELECT available_qty::text FROM wms_stock_balances
       WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint`,
      [siteId, loc.location_id, r.item.item_id]
    );
    if (bal.rows.length === 0) {
      throw new WmsHttpError(
        404,
        `no balance for item ${r.item.item_code} at location`,
        "no_balance"
      );
    }
    const accounted = Number(bal.rows[0].available_qty);
    const actual = r.actualQty;
    const variance = actual - accounted;
    accountedTotal += accounted;
    actualTotal += actual;
    varianceTotal += variance;
    computed.push({ item: r.item, accounted, actual, variance });
  }

  const doc = await client.query<{ document_id: string }>(
    `INSERT INTO wms_documents (
       site_id, document_type_id, document_status_id, request_id, source_location_id, applied_at
     ) VALUES ($1, 8, 3, $2::uuid, $3::bigint, now())
     RETURNING document_id::text`,
    [siteId, p.requestId, loc.location_id]
  );
  const documentId = doc.rows[0].document_id;

  const rev = await client.query<{ revision_id: string }>(
    `INSERT INTO wms_revisions (
       site_id, document_id, location_id, request_id, checked_by_name, comment,
       document_status_id, accounted_total_qty, actual_total_qty, variance_total_qty, completed_at
     ) VALUES ($1, $2::bigint, $3::bigint, $4::uuid, $5, $6, 3, $7, $8, $9, now())
     RETURNING revision_id::text`,
    [
      siteId,
      documentId,
      loc.location_id,
      p.requestId,
      p.checkedBy,
      p.comment,
      accountedTotal,
      actualTotal,
      varianceTotal,
    ]
  );
  const revisionId = rev.rows[0].revision_id;

  for (const c of computed) {
    await client.query(
      `UPDATE wms_stock_balances SET
         available_qty = $1,
         updated_at = now()
       WHERE site_id = $2 AND location_id = $3::bigint AND item_id = $4::bigint`,
      [c.actual, siteId, loc.location_id, c.item.item_id]
    );

    await client.query(
      `INSERT INTO wms_revision_lines (revision_id, item_id, accounted_qty, actual_qty, variance_qty)
       VALUES ($1::bigint, $2::bigint, $3, $4, $5)`,
      [revisionId, c.item.item_id, c.accounted, c.actual, c.variance]
    );

    const ad = Math.abs(c.variance);
    if (ad < 1e-9) continue;

    if (c.variance > 0) {
      await client.query(
        `INSERT INTO wms_stock_movements (
           site_id, movement_type_id, document_id, item_id,
           to_location_id, to_bucket_id, qty, request_id
         ) VALUES ($1, 8, $2::bigint, $3::bigint, $4::bigint, 1, $5, $6::uuid)`,
        [siteId, documentId, c.item.item_id, loc.location_id, c.variance, p.requestId]
      );
    } else {
      await client.query(
        `INSERT INTO wms_stock_movements (
           site_id, movement_type_id, document_id, item_id,
           from_location_id, from_bucket_id, qty, request_id
         ) VALUES ($1, 8, $2::bigint, $3::bigint, $4::bigint, 1, $5, $6::uuid)`,
        [siteId, documentId, c.item.item_id, loc.location_id, ad, p.requestId]
      );
    }
  }

  const first = computed[0];
  const stock = await fetchBalanceSnapshot(
    client,
    siteId,
    loc.location_id,
    first.item.item_id
  );

  return { documentId, documentType: "revision", revisionId, stock };
}
