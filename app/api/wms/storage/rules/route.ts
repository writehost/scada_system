import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { createStorageRule, listStorageRules } from "@/lib/wms/storage-rules";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim();
  const activeOnly = url.searchParams.get("activeOnly") === "1";
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const rules = await listStorageRules(client, siteId, activeOnly);
    return NextResponse.json({ rules });
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

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = String(body.siteCode ?? "").trim();
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const rule = await createStorageRule(client, siteId, {
      name: String(body.name ?? ""),
      materialType: body.materialType as string | null | undefined,
      processType: body.processType as string | null | undefined,
      stickerShape: body.stickerShape as string | null | undefined,
      productGroup: body.productGroup as string | null | undefined,
      brand: body.brand as string | null | undefined,
      productType: body.productType as string | null | undefined,
      carbonationType: body.carbonationType as string | null | undefined,
      volume: body.volume as string | null | undefined,
      applicationPlace: body.applicationPlace as string | null | undefined,
      storageClass: body.storageClass as string | null | undefined,
      allowedZoneCodes: Array.isArray(body.allowedZoneCodes)
        ? (body.allowedZoneCodes as string[])
        : undefined,
      forbiddenZoneCodes: Array.isArray(body.forbiddenZoneCodes)
        ? (body.forbiddenZoneCodes as string[])
        : undefined,
      enforcePreferredLocation:
        typeof body.enforcePreferredLocation === "boolean"
          ? body.enforcePreferredLocation
          : undefined,
      criteria: (body.criteria as Record<string, unknown> | null) ?? undefined,
      preferredZoneId: body.preferredZoneId as string | null | undefined,
      preferredLocationId: body.preferredLocationId as string | null | undefined,
      priority: body.priority != null ? Number(body.priority) : undefined,
      isActive: body.isActive !== false,
      note: body.note as string | null | undefined,
    });

    return NextResponse.json({ rule }, { status: 201 });
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
