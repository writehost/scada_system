import { NextResponse } from "next/server";
import { WmsHttpError } from "@/lib/wms/errors";
import { generateInternalMarkingCodes } from "@/lib/wms/internal-marking";
import { tryGetPool } from "@/lib/wms/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  siteCode?: string;
  itemCode?: string;
  qty?: number;
  markPrinted?: boolean;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  const itemCode = typeof body.itemCode === "string" ? body.itemCode.trim() : "";
  if (!siteCode || !itemCode) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await generateInternalMarkingCodes(client, {
      siteCode,
      itemCode,
      qty: body.qty ?? 1,
      markPrinted: body.markPrinted ?? true,
    });
    await client.query("COMMIT");
    return NextResponse.json(result);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  } finally {
    client.release();
  }
}
