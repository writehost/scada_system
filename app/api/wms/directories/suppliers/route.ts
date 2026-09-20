import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  createSupplierDef,
  listSupplierDefs,
  normalizeSupplierCode,
  supplierCodeFromName,
} from "@/lib/wms/supplier-directory";

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
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const suppliers = await listSupplierDefs(client, siteId);
    let contractSummaries: Record<string, { count: number; defaultNumber: string | null }> = {};
    try {
      const { getSupplierContractSummaries } = await import("@/lib/wms/supplier-contract-directory");
      contractSummaries = await getSupplierContractSummaries(client, siteId);
    } catch {
      contractSummaries = {};
    }
    return NextResponse.json({
      suppliers: suppliers.map((s) => ({
        ...s,
        contractCount: contractSummaries[s.code.toUpperCase()]?.count ?? 0,
        defaultContractNumber: contractSummaries[s.code.toUpperCase()]?.defaultNumber ?? null,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "query failed";
    if (msg.includes("wms_suppliers") || msg.includes("does not exist")) {
      return NextResponse.json({ suppliers: [] });
    }
    throw e;
  } finally {
    client.release();
  }
}

type PostBody = {
  siteCode?: string;
  code?: string;
  name?: string;
  taxId?: string | null;
  meta?: Record<string, unknown>;
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
  const name = (body.name ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  let code: string | undefined;
  if (body.code?.trim()) {
    try {
      code = normalizeSupplierCode(body.code);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "invalid code" },
        { status: 400 }
      );
    }
  } else {
    code = supplierCodeFromName(name);
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const supplier = await createSupplierDef(client, siteId, {
      code,
      name,
      taxId: body.taxId,
      meta: body.meta as import("@/lib/wms/supplier-directory-meta").SupplierMeta | undefined,
    });
    return NextResponse.json({ supplier }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("duplicate key") || msg.includes("wms_suppliers_site_id_supplier_code")) {
      return NextResponse.json({ error: "контрагент с таким кодом уже есть", code: "duplicate" }, { status: 409 });
    }
    if (msg.includes("wms_suppliers") || msg.includes("does not exist")) {
      return NextResponse.json({ error: "таблица wms_suppliers не создана — выполните миграцию БД" }, { status: 503 });
    }
    throw e;
  } finally {
    client.release();
  }
}
