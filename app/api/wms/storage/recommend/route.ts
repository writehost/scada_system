import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { recommendStorageLocations } from "@/lib/wms/storage-slot";
import { WmsHttpError } from "@/lib/wms/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: {
    siteCode?: string;
    itemCode?: string;
    qty?: number;
    preferReceiving?: boolean;
    limit?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = String(body.siteCode ?? "").trim();
  const itemCode = String(body.itemCode ?? "").trim();
  if (!siteCode || !itemCode) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const result = await recommendStorageLocations(client, siteId, {
      itemCode,
      qty: body.qty,
      preferReceiving: body.preferReceiving,
      limit: body.limit,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}
