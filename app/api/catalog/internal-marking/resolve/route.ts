import { NextResponse } from "next/server";
import { WmsHttpError } from "@/lib/wms/errors";
import { resolveInternalMarkingCode } from "@/lib/wms/internal-marking";
import { tryGetPool } from "@/lib/wms/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  siteCode?: string;
  code?: string;
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
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!siteCode || !code) {
    return NextResponse.json({ error: "siteCode and code are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const result = await resolveInternalMarkingCode(client, { siteCode, code });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  } finally {
    client.release();
  }
}
