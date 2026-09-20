import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsErrorResponse } from "@/lib/wms/errors";
import { applyLocationWriteoff, previewLocationWriteoff } from "@/lib/wms/writeoff";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const locationCode = url.searchParams.get("locationCode") ?? "";
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!locationCode.trim()) {
    return NextResponse.json({ error: "locationCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const preview = await previewLocationWriteoff(client, siteId, locationCode);
    return NextResponse.json({ preview });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}

type PostBody = {
  siteCode?: string;
  requestId?: string;
  locationCode?: string;
  reasonCode?: string;
  comment?: string | null;
  lines?: Array<{ itemCode?: string; lotCode?: string | null; qty?: number | null }>;
};

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = (body.siteCode ?? "").trim();
  const locationCode = (body.locationCode ?? "").trim();
  const reasonCode = (body.reasonCode ?? "").trim();
  const requestId = (body.requestId ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!locationCode) return NextResponse.json({ error: "locationCode is required" }, { status: 400 });
  if (!reasonCode) return NextResponse.json({ error: "reasonCode is required" }, { status: 400 });
  if (!requestId) return NextResponse.json({ error: "requestId is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    await client.query("BEGIN");
    const result = await applyLocationWriteoff(client, siteId, {
      requestId,
      locationCode,
      reasonCode,
      comment: body.comment,
      lines: (body.lines ?? [])
        .map((line) => ({
          itemCode: (line.itemCode ?? "").trim(),
          lotCode: line.lotCode,
          qty: line.qty,
        }))
        .filter((line) => line.itemCode),
    });
    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      documentId: result.documentId,
      documentNo: result.documentNo,
      lineCount: result.lineCount,
      codesCount: result.codesCount,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
