import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { parseRequestId } from "@/lib/wms/uuid";
import { WmsHttpError } from "@/lib/wms/errors";
import { receiveStickerToWorkshopCell } from "@/lib/wms/workshop-direct-receipt";
import { requireLineApi } from "@/lib/wms/line-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requireLineApi(req);
  if (denied) return denied;

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
    targetLocationCode?: string;
    itemCode?: string;
    datamatrix?: string;
    qty?: number;
    operatorName?: string;
    manufacturedAt?: string;
    expiryAt?: string;
    lotCode?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(body.requestId) ?? randomUUID();
  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  const targetLocationCode =
    typeof body.targetLocationCode === "string" ? body.targetLocationCode.trim() : "";
  const datamatrix = typeof body.datamatrix === "string" ? body.datamatrix.trim() : "";
  const qty = Number(body.qty ?? 1);

  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!targetLocationCode) {
    return NextResponse.json({ error: "targetLocationCode is required" }, { status: 400 });
  }
  if (!datamatrix) return NextResponse.json({ error: "datamatrix is required" }, { status: 400 });
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "qty must be positive" }, { status: 400 });
  }

  const probe = await pool.connect();
  let siteId: number;
  try {
    const sid = await getSiteId(probe, siteCode);
    if (sid == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    siteId = sid;
  } finally {
    probe.release();
  }

  try {
    const result = await runIdempotentWrite(
      pool,
      requestId,
      siteId,
      "workshop_receive",
      body,
      (client) =>
        receiveStickerToWorkshopCell(client, siteId, {
          requestId,
          targetLocationCode,
          itemCode: typeof body.itemCode === "string" ? body.itemCode : null,
          datamatrix,
          qty,
          operatorName: typeof body.operatorName === "string" ? body.operatorName : null,
          manufacturedAt: typeof body.manufacturedAt === "string" ? body.manufacturedAt : null,
          expiryAt: typeof body.expiryAt === "string" ? body.expiryAt : null,
          lotCode: typeof body.lotCode === "string" ? body.lotCode : null,
        })
    );
    return NextResponse.json({ ...result, disposition: "applied" });
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status }
      );
    }
    console.error("[POST /api/wms/production/workshop-receive]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "workshop receive failed" },
      { status: 500 }
    );
  }
}
