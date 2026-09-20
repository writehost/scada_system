import { NextResponse } from "next/server";
import { wmsErrorResponse } from "@/lib/wms/errors";
import {
  applyFgWarehouseReceipt,
  type FgReceiptLineInput,
} from "@/lib/wms/finished-goods-ingest";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { parseRequestId } from "@/lib/wms/uuid";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReceiptBody = {
  requestId?: string;
  siteCode?: string;
  externalId?: string;
  sourceSystem?: string;
  dryRun?: boolean;
  lines?: FgReceiptLineInput[];
  itemCode?: string;
  locationCode?: string;
  qty?: number;
  lotCode?: string;
  manufacturedAt?: string;
  expiryAt?: string;
  bestBeforeAt?: string;
  markingCodes?: string[];
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLine(raw: Partial<FgReceiptLineInput>): FgReceiptLineInput {
  return {
    itemCode: cleanText(raw.itemCode),
    locationCode: cleanText(raw.locationCode),
    qty: Number(raw.qty),
    lotCode: cleanText(raw.lotCode) || undefined,
    manufacturedAt: cleanText(raw.manufacturedAt) || undefined,
    expiryAt: cleanText(raw.expiryAt) || undefined,
    bestBeforeAt: cleanText(raw.bestBeforeAt) || undefined,
    markingCodes: Array.isArray(raw.markingCodes)
      ? raw.markingCodes.map((c) => cleanText(c)).filter(Boolean)
      : undefined,
  };
}

function normalizeLines(body: ReceiptBody): FgReceiptLineInput[] {
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    return body.lines.map((line) => normalizeLine(line));
  }
  const single = normalizeLine(body);
  if (single.itemCode && single.locationCode) return [single];
  return [];
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  let body: ReceiptBody;
  try {
    body = (await req.json()) as ReceiptBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(body.requestId);
  const siteCode = cleanText(body.siteCode);
  const lines = normalizeLines(body);

  if (!requestId) {
    return NextResponse.json({ error: "requestId (UUID) is required" }, { status: 400 });
  }
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (lines.length === 0) {
    return NextResponse.json(
      { error: "lines[] or itemCode+locationCode+qty is required" },
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

  if (body.dryRun) {
    return NextResponse.json({
      disposition: "dry_run",
      siteCode,
      externalId: cleanText(body.externalId) || null,
      sourceSystem: cleanText(body.sourceSystem) || null,
      lines: lines.map((line) => ({
        itemCode: line.itemCode,
        locationCode: line.locationCode,
        qty: line.qty,
        markingCodesCount: line.markingCodes?.length ?? 0,
      })),
    });
  }

  try {
    const result = await runIdempotentWrite(
      pool,
      requestId,
      siteId,
      "fg_receipt",
      body,
      async (client) =>
        applyFgWarehouseReceipt(client, {
          siteId,
          sourceSystem: cleanText(body.sourceSystem) || undefined,
          externalId: cleanText(body.externalId) || undefined,
          lines,
        })
    );
    return NextResponse.json(result);
  } catch (e) {
    return wmsErrorResponse(e);
  }
}
