import { NextResponse } from "next/server";
import { getItemOverview, listItemMovements } from "@/lib/wms/catalog";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  segmentData: { params: Promise<{ itemCode: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const params = await segmentData.params;
  const itemCode = decodeURIComponent(params.itemCode ?? "");
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim() || !itemCode.trim()) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 });
  }

  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");
  const daysRaw = url.searchParams.get("days");
  const days =
    daysRaw == null || daysRaw.trim() === "" ? null : Number.parseInt(daysRaw, 10);

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const overview = await getItemOverview(client, siteId, itemCode);
    if (!overview) {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }

    const result = await listItemMovements(client, siteId, String(overview.item.itemId), {
      limit: limitRaw == null ? undefined : Number(limitRaw),
      offset: offsetRaw == null ? undefined : Number(offsetRaw),
      days: days != null && Number.isFinite(days) ? days : null,
    });

    return NextResponse.json(result);
  } finally {
    client.release();
  }
}
