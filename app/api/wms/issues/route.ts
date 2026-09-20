import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getSiteId } from "@/lib/wms/resolve";
import { tryGetPool } from "@/lib/wms/pool";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { parseRequestId } from "@/lib/wms/uuid";
import { WmsHttpError } from "@/lib/wms/errors";
import { issueToProduction } from "@/lib/wms/issue-stock";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    itemCode?: string;
    sourceLocationCode?: string;
    targetLocationCode?: string;
    qty?: number;
    recipientName?: string;
    lineName?: string;
    lotCode?: string;
    emissionDay?: string;
    emissionAtIso?: string;
    codeValues?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(body.requestId) ?? randomUUID();
  const siteCode = typeof body.siteCode === "string" ? body.siteCode : "";
  const itemCode = typeof body.itemCode === "string" ? body.itemCode : "";
  const sourceLocationCode =
    typeof body.sourceLocationCode === "string" ? body.sourceLocationCode : "";
  const targetLocationCode =
    typeof body.targetLocationCode === "string" ? body.targetLocationCode : "";
  const qty = Number(body.qty);
  const recipientName =
    typeof body.recipientName === "string" ? body.recipientName.trim() : "";
  const lineName =
    typeof body.lineName === "string" ? body.lineName.trim() : "";
  const lotCode = typeof body.lotCode === "string" ? body.lotCode.trim() : "";
  const emissionDay =
    typeof body.emissionDay === "string" ? body.emissionDay.trim() : "";
  const emissionAtIso =
    typeof body.emissionAtIso === "string" ? body.emissionAtIso.trim() : "";
  const codeValues = Array.isArray(body.codeValues)
    ? body.codeValues.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : undefined;

  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!itemCode.trim()) {
    return NextResponse.json({ error: "itemCode is required" }, { status: 400 });
  }
  if (!sourceLocationCode.trim()) {
    return NextResponse.json(
      { error: "sourceLocationCode is required" },
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
  if (!recipientName) {
    return NextResponse.json({ error: "recipientName is required" }, { status: 400 });
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
      "issue",
      body,
      (client) =>
        issueToProduction(client, siteId, {
          requestId,
          itemCode,
          sourceLocationCode,
          targetLocationCode,
          qty,
          recipientName,
          lineName: lineName || null,
          lotCode: lotCode || null,
          emissionDay: emissionDay || null,
          emissionAtIso: emissionAtIso || null,
          codeValues,
        })
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json(
        { error: e.message, code: e.code, details: e.details },
        { status: e.status }
      );
    }
    console.error("[issues POST]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "issue failed" },
      { status: 500 }
    );
  }
}
