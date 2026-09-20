import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { patchProductionLineDef } from "@/lib/wms/production-line-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateBody = {
  siteCode?: string;
  lineCode?: string;
  displayName?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const lineCode = decodeURIComponent(body.lineCode ?? "").trim().toUpperCase();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!lineCode) return NextResponse.json({ error: "lineCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const line = await patchProductionLineDef(client, siteId, lineCode, {
      displayName: body.displayName,
      sortOrder: body.sortOrder,
      isActive: body.isActive,
    });
    if (!line) {
      return NextResponse.json({ error: "not found or no fields to update" }, { status: 404 });
    }
    return NextResponse.json({ line });
  } finally {
    client.release();
  }
}
