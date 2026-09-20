import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { listVirtualLayouts, upsertVirtualLayout } from "@/lib/wms/virtual";
import { WmsHttpError } from "@/lib/wms/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapVirtualApiError(error: unknown) {
  if (error instanceof WmsHttpError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  ) {
    return NextResponse.json(
      {
        error:
          "Таблицы виртуального склада ещё не созданы в БД. Запустите migrate-db.ps1 и обновите страницу.",
        code: "virtual_schema_missing",
      },
      { status: 503 }
    );
  }
  return null;
}

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
    const data = await listVirtualLayouts(client, siteId, {
      warehouseCode: url.searchParams.get("warehouseCode") ?? "",
      query: url.searchParams.get("query") ?? "",
    });
    return NextResponse.json(data);
  } catch (error) {
    const mapped = mapVirtualApiError(error);
    if (mapped) return mapped;
    throw error;
  } finally {
    client.release();
  }
}

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
    layoutCode?: string;
    name?: string;
    warehouseCode?: string;
    zoneCode?: string;
    description?: string;
    scenePrefs?: Record<string, unknown> | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await upsertVirtualLayout(client, siteId, {
      siteCode,
      layoutCode: typeof body.layoutCode === "string" ? body.layoutCode : "",
      name: typeof body.name === "string" ? body.name : "",
      warehouseCode: typeof body.warehouseCode === "string" ? body.warehouseCode : undefined,
      zoneCode: typeof body.zoneCode === "string" ? body.zoneCode : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      scenePrefs: body.scenePrefs ?? null,
    });
    return NextResponse.json(data);
  } catch (error) {
    const mapped = mapVirtualApiError(error);
    if (mapped) return mapped;
    throw error;
  } finally {
    client.release();
  }
}
