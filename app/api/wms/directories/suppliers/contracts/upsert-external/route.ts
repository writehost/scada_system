import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  upsertExternalSupplierContracts,
  type ExternalContractUpsertInput,
} from "@/lib/wms/supplier-contract-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Массовая загрузка/обновление договоров из внешней системы (1С, API).
 * Сопоставление по externalSource + externalId; контрагент — по supplierCode.
 */
type UpsertBody = {
  siteCode?: string;
  supplierCode?: string;
  externalSource?: string;
  contracts?: ExternalContractUpsertInput[];
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: UpsertBody;
  try {
    body = (await req.json()) as UpsertBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const supplierCode = (body.supplierCode ?? "").trim().toUpperCase();
  const contracts = Array.isArray(body.contracts) ? body.contracts : [];
  const defaultSource = body.externalSource?.trim() || "1c";

  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!supplierCode) return NextResponse.json({ error: "supplierCode is required" }, { status: 400 });
  if (contracts.length === 0) {
    return NextResponse.json({ error: "contracts array is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const normalized = contracts.map((c) => ({
      ...c,
      externalSource: c.externalSource || defaultSource,
    }));

    const upserted = await upsertExternalSupplierContracts(client, siteId, supplierCode, normalized);
    return NextResponse.json({ contracts: upserted, upserted: upserted.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "supplier not found") {
      return NextResponse.json({ error: "контрагент не найден" }, { status: 404 });
    }
    if (msg.includes("wms_supplier_contracts") || msg.includes("does not exist")) {
      return NextResponse.json({ error: "таблица договоров не создана — выполните миграцию БД" }, { status: 503 });
    }
    throw e;
  } finally {
    client.release();
  }
}
