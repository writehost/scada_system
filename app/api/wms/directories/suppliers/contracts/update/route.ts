import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { patchSupplierContract } from "@/lib/wms/supplier-contract-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateBody = {
  siteCode?: string;
  contractCode?: string;
  number?: string | null;
  name?: string;
  contractType?: string;
  validFrom?: string | null;
  validTo?: string | null;
  currency?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  externalSource?: string;
  externalId?: string | null;
  externalRef?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  note?: string | null;
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
  const contractCode = decodeURIComponent(body.contractCode ?? "").trim().toUpperCase();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!contractCode) return NextResponse.json({ error: "contractCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const contract = await patchSupplierContract(client, siteId, contractCode, body);
    if (!contract) {
      return NextResponse.json({ error: "not found or no fields to update" }, { status: 404 });
    }
    return NextResponse.json({ contract });
  } finally {
    client.release();
  }
}
