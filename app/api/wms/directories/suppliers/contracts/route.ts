import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  createSupplierContract,
  listSupplierContracts,
} from "@/lib/wms/supplier-contract-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const supplierCode = (url.searchParams.get("supplierCode") ?? "").trim().toUpperCase();
  const activeOnly = url.searchParams.get("activeOnly") === "1";

  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!supplierCode) {
    return NextResponse.json({ error: "supplierCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const contracts = await listSupplierContracts(client, siteId, supplierCode, { activeOnly });
    return NextResponse.json({ contracts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "query failed";
    if (msg.includes("wms_supplier_contracts") || msg.includes("does not exist")) {
      return NextResponse.json({ contracts: [] });
    }
    throw e;
  } finally {
    client.release();
  }
}

type PostBody = {
  siteCode?: string;
  supplierCode?: string;
  code?: string;
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

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const supplierCode = (body.supplierCode ?? "").trim().toUpperCase();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!supplierCode) return NextResponse.json({ error: "supplierCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const contract = await createSupplierContract(client, siteId, supplierCode, body);
    return NextResponse.json({ contract }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "supplier not found") {
      return NextResponse.json({ error: "контрагент не найден" }, { status: 404 });
    }
    if (msg.includes("duplicate key") || msg.includes("contract_code")) {
      return NextResponse.json({ error: "договор с таким кодом уже есть", code: "duplicate" }, { status: 409 });
    }
    if (msg.includes("name is required") || msg.includes("code:")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg.includes("wms_supplier_contracts") || msg.includes("does not exist")) {
      return NextResponse.json({ error: "таблица договоров не создана — выполните миграцию БД" }, { status: 503 });
    }
    throw e;
  } finally {
    client.release();
  }
}
