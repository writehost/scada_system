import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  deleteStorageRule,
  getStorageRuleById,
  updateStorageRule,
} from "@/lib/wms/storage-rules";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  const { id } = await ctx.params;
  const siteCode = new URL(req.url).searchParams.get("siteCode")?.trim() ?? "";
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const rule = await getStorageRuleById(client, siteId, id);
    if (!rule) {
      return NextResponse.json({ error: "rule not found" }, { status: 404 });
    }
    return NextResponse.json({ rule });
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

export async function PATCH(req: Request, ctx: Ctx) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  const { id } = await ctx.params;
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

    const rule = await updateStorageRule(client, siteId, id, {
      name: body.name != null ? String(body.name) : undefined,
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
        : body.allowedZoneCodes === null
          ? null
          : undefined,
      forbiddenZoneCodes: Array.isArray(body.forbiddenZoneCodes)
        ? (body.forbiddenZoneCodes as string[])
        : body.forbiddenZoneCodes === null
          ? null
          : undefined,
      enforcePreferredLocation:
        typeof body.enforcePreferredLocation === "boolean"
          ? body.enforcePreferredLocation
          : undefined,
      criteria: body.criteria === undefined ? undefined : (body.criteria as Record<string, unknown> | null),
      preferredZoneId: body.preferredZoneId as string | null | undefined,
      preferredLocationId: body.preferredLocationId as string | null | undefined,
      priority: body.priority != null ? Number(body.priority) : undefined,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
      note: body.note as string | null | undefined,
    });

    return NextResponse.json({ rule });
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

export async function DELETE(req: Request, ctx: Ctx) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  const { id } = await ctx.params;
  const siteCode = new URL(req.url).searchParams.get("siteCode")?.trim() ?? "";
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    await deleteStorageRule(client, siteId, id);
    return NextResponse.json({ ok: true });
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
