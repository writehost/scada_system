import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { deleteVirtualLayout, getVirtualLayout, upsertVirtualLayout } from "@/lib/wms/virtual";
import { WmsHttpError } from "@/lib/wms/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const layoutId = params.id ?? "";
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const includeContents = (url.searchParams.get("includeContents") ?? "1").trim() !== "0";
  if (!siteCode.trim() || !layoutId.trim()) {
    return NextResponse.json({ error: "siteCode and layoutId are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await getVirtualLayout(client, siteId, layoutId, { includeContents });
    if (!data) {
      return NextResponse.json({ error: "layout not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } finally {
    client.release();
  }
}

export async function POST(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const layoutId = params.id ?? "";
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
  if (!siteCode.trim() || !layoutId.trim()) {
    return NextResponse.json({ error: "siteCode and layoutId are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const current = await getVirtualLayout(client, siteId, layoutId);
    if (!current) {
      return NextResponse.json({ error: "layout not found" }, { status: 404 });
    }
    const data = await upsertVirtualLayout(client, siteId, {
      siteCode,
      layoutCode:
        typeof body.layoutCode === "string" && body.layoutCode.trim()
          ? body.layoutCode
          : current.layout.layoutCode,
      name:
        typeof body.name === "string" && body.name.trim() ? body.name : current.layout.name,
      warehouseCode:
        typeof body.warehouseCode === "string" ? body.warehouseCode : current.layout.warehouseCode ?? undefined,
      zoneCode: typeof body.zoneCode === "string" ? body.zoneCode : current.layout.zoneCode ?? undefined,
      description:
        typeof body.description === "string" ? body.description : current.layout.description ?? undefined,
      scenePrefs: body.scenePrefs ?? current.layout.scenePrefs ?? null,
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function DELETE(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const layoutId = params.id ?? "";
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim() || !layoutId.trim()) {
    return NextResponse.json({ error: "siteCode and layoutId are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await deleteVirtualLayout(client, siteId, layoutId);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  } finally {
    client.release();
  }
}
