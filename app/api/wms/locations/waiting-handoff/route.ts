import { NextResponse } from "next/server";
import { WmsHttpError } from "@/lib/wms/errors";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  clearWaitingHandoffFromAttrs,
  getWorkshopCellOccupancy,
  isWaitingPointCell,
  mergeWaitingHandoffIntoAttrs,
  parseWaitingHandoffFromAttrs,
  type WaitingCellHandoff,
} from "@/lib/wms/workshop-waiting-cell";
import { parseSlotProfileFromAttrs } from "@/lib/wms/storage-slot";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HandoffBody = {
  siteCode?: unknown;
  locationCode?: unknown;
  lineCode?: unknown;
  batchLabel?: unknown;
  itemCode?: unknown;
  planId?: unknown;
  planCode?: unknown;
  planProductName?: unknown;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: HandoffBody;
  try {
    body = (await req.json()) as HandoffBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = cleanText(body.siteCode);
  const locationCode = cleanText(body.locationCode).toUpperCase();
  const lineCode = cleanText(body.lineCode);
  const batchLabel = cleanText(body.batchLabel) || null;
  const itemCode = cleanText(body.itemCode) || null;
  const planId = cleanText(body.planId) || null;
  const planCode = cleanText(body.planCode) || null;
  const planProductName = cleanText(body.planProductName) || null;

  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!locationCode) {
    return NextResponse.json({ error: "locationCode is required" }, { status: 400 });
  }
  if (!lineCode) {
    return NextResponse.json({ error: "lineCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const loc = await client.query<{
      location_id: string;
      location_attrs_json: unknown;
    }>(
      `SELECT location_id::text, location_attrs_json
       FROM wms_locations
       WHERE site_id = $1 AND location_code = $2`,
      [siteId, locationCode]
    );
    if (loc.rows.length === 0) {
      return NextResponse.json({ error: "location not found" }, { status: 404 });
    }

    const row = loc.rows[0];
    const occupancy = await getWorkshopCellOccupancy(client, siteId, row.location_id);
    if (occupancy.isEmpty) {
      return NextResponse.json(
        { error: "Ячейка пустая — передавать на линию нечего", code: "cell_empty" },
        { status: 409 }
      );
    }
    // Профиль WAITING не обязателен: A-1 и др. часто имеют остаток «в цеху» без storagePurpose=WAITING.
    // mergeWaitingHandoffIntoAttrs поднимет профиль до WAITING при сохранении.

    const resolvedItemCode = itemCode || occupancy.primaryItemCode;
    if (
      resolvedItemCode &&
      occupancy.primaryItemCode &&
      resolvedItemCode.toLowerCase() !== occupancy.primaryItemCode.toLowerCase()
    ) {
      return NextResponse.json(
        { error: "item does not match cell occupancy", code: "item_mismatch" },
        { status: 409 }
      );
    }

    const handoff: WaitingCellHandoff = {
      status: "handed_to_production",
      lineCode,
      batchLabel,
      itemCode: resolvedItemCode,
      planId,
      planCode,
      planProductName,
      handedAt: new Date().toISOString(),
    };

    const mergedAttrs = mergeWaitingHandoffIntoAttrs(row.location_attrs_json, handoff);
    await client.query(
      `UPDATE wms_locations
       SET location_attrs_json = $3::jsonb, updated_at = now()
       WHERE site_id = $1 AND location_id = $2::bigint`,
      [siteId, row.location_id, JSON.stringify(mergedAttrs)]
    );

    return NextResponse.json({
      ok: true,
      locationCode,
      waitingHandoff: parseWaitingHandoffFromAttrs(mergedAttrs),
    });
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error("[POST /api/wms/locations/waiting-handoff]", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const siteCode = cleanText(url.searchParams.get("siteCode"));
  const locationCode = cleanText(url.searchParams.get("locationCode")).toUpperCase();

  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!locationCode) {
    return NextResponse.json({ error: "locationCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const loc = await client.query<{
      location_id: string;
      location_attrs_json: unknown;
    }>(
      `SELECT location_id::text, location_attrs_json
       FROM wms_locations
       WHERE site_id = $1 AND location_code = $2`,
      [siteId, locationCode]
    );
    if (loc.rows.length === 0) {
      return NextResponse.json({ error: "location not found" }, { status: 404 });
    }

    const row = loc.rows[0];
    const slot = parseSlotProfileFromAttrs(row.location_attrs_json);
    const existingHandoff = parseWaitingHandoffFromAttrs(row.location_attrs_json);
    if (!isWaitingPointCell(slot) && !existingHandoff) {
      return NextResponse.json(
        {
          error: "Снять передачу можно только с точки ожидания или ячейки, уже отданной на линию",
          code: "not_waiting_cell",
        },
        { status: 409 }
      );
    }

    const mergedAttrs = clearWaitingHandoffFromAttrs(row.location_attrs_json);
    await client.query(
      `UPDATE wms_locations
       SET location_attrs_json = $3::jsonb, updated_at = now()
       WHERE site_id = $1 AND location_id = $2::bigint`,
      [siteId, row.location_id, JSON.stringify(mergedAttrs)]
    );

    return NextResponse.json({
      ok: true,
      locationCode,
      waitingHandoff: null,
    });
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error("[DELETE /api/wms/locations/waiting-handoff]", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}
