import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsErrorResponse } from "@/lib/wms/errors";
import { patchWriteoffReasonDef } from "@/lib/wms/writeoff-reasons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateBody = {
  siteCode?: string;
  reasonCode?: string;
  displayName?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }
  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = (body.siteCode ?? "").trim();
  const reasonCode = (body.reasonCode ?? "").trim().toUpperCase();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!reasonCode) return NextResponse.json({ error: "reasonCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const reason = await patchWriteoffReasonDef(client, siteId, reasonCode, {
      displayName: body.displayName,
      sortOrder: body.sortOrder,
      isActive: body.isActive,
    });
    if (!reason) return NextResponse.json({ error: "not found or no fields to update" }, { status: 404 });
    return NextResponse.json({ reason });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
