import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { WmsHttpError } from "@/lib/wms/errors";
import { moveLotQtyBetweenBuckets } from "@/lib/wms/lots-actions";
import { WMS_STOCK_BUCKET } from "@/lib/wms/ref";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bucketCodeToId(code: string): number | null {
  switch (code) {
    case "available":
      return WMS_STOCK_BUCKET.available;
    case "quarantine":
      return WMS_STOCK_BUCKET.quarantine;
    default:
      return null;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ lotId: string }> }) {
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
        fromBucket?: unknown;
        toBucket?: unknown;
        qty?: unknown;
        requestId?: unknown;
      }
    | null;

  const siteCode = typeof body?.siteCode === "string" ? body.siteCode : "";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const fromBucket = typeof body?.fromBucket === "string" ? body.fromBucket : "";
  const toBucket = typeof body?.toBucket === "string" ? body.toBucket : "";
  const fromBucketId = bucketCodeToId(fromBucket);
  const toBucketId = bucketCodeToId(toBucket);
  if (!fromBucketId || !toBucketId) {
    return NextResponse.json(
      { error: "fromBucket/toBucket must be 'available' or 'quarantine'" },
      { status: 400 }
    );
  }

  const qty = typeof body?.qty === "number" ? body.qty : Number(body?.qty);
  if (!(qty > 0)) {
    return NextResponse.json({ error: "qty must be > 0" }, { status: 400 });
  }
  const requestId = typeof body?.requestId === "string" ? body.requestId : null;

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    await client.query("BEGIN");
    await moveLotQtyBetweenBuckets(client, siteId, lotId, {
      fromBucketId,
      toBucketId,
      qty,
      requestId,
    });
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

