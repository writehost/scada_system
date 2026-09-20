import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { WmsHttpError } from "@/lib/wms/errors";
import { updateLotMaster } from "@/lib/wms/lots-actions";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ lotId: string }> }) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const { lotId } = await ctx.params;
  if (!lotId || !String(lotId).trim()) {
    return NextResponse.json({ error: "lotId is required" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        siteCode?: unknown;
        qaStatusCode?: unknown;
        note?: unknown;
        isBlocked?: unknown;
      }
    | null;

  const siteCode = typeof body?.siteCode === "string" ? body.siteCode : "";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const patch: { qaStatusCode?: string | null; note?: string | null; isBlocked?: boolean | null } = {};
  if (body && "qaStatusCode" in body) {
    patch.qaStatusCode = typeof body.qaStatusCode === "string" ? body.qaStatusCode : null;
  }
  if (body && "note" in body) {
    patch.note = typeof body.note === "string" ? body.note : null;
  }
  if (body && "isBlocked" in body) {
    patch.isBlocked = typeof body.isBlocked === "boolean" ? body.isBlocked : null;
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    await client.query("BEGIN");
    await updateLotMaster(client, siteId, lotId, patch);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    const err = e as unknown;
    if (err instanceof WmsHttpError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: err.status }
      );
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}

