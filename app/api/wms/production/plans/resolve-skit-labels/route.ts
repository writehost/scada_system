import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsErrorResponse } from "@/lib/wms/errors";
import { resolveSkitProductLabels } from "@/lib/wms/skit-product-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  siteCode?: string;
  labels?: string[];
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const labels = Array.isArray(body.labels) ? body.labels.map((l) => String(l).trim()).filter(Boolean) : [];
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (labels.length === 0) return NextResponse.json({ error: "labels is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const matches = await resolveSkitProductLabels(client, siteId, labels);
    return NextResponse.json({ matches });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
