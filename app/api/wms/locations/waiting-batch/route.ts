import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { mergeSlotIntoLocationAttrs, parseSlotProfileFromAttrs } from "@/lib/wms/storage-slot";
import { ZONE_LABELS } from "@/lib/storage-slot-ui";
import { requireWmsActor } from "@/lib/wms/require-actor";
import {
  DEFAULT_RECEIVING_CATEGORY_CODE,
  DEFAULT_STICKERS_ITEM_GROUPS,
  MAX_WAITING_BATCH_COUNT,
  buildSequentialWaitingCellCode,
  buildWaitingSlotProfile,
  randomWaitingCellSuffix,
  randomWaitingDisplayName,
  sanitizeWaitingCodePrefix,
  sequentialWaitingDisplayName,
} from "@/lib/wms/workshop-waiting-cell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WaitingBatchBody = {
  siteCode?: unknown;
  warehouseCode?: unknown;
  zoneCode?: unknown;
  count?: unknown;
  codePrefix?: unknown;
  namePrefix?: unknown;
  startIndex?: unknown;
  namingMode?: unknown;
  receivingCategoryCode?: unknown;
};

type BackfillBody = {
  siteCode?: unknown;
  warehouseCode?: unknown;
  receivingCategoryCode?: unknown;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_WAITING_BATCH_COUNT);
}

function parseStartIndex(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(Math.trunc(n), 1), 99999);
}

function parseNamingMode(value: unknown): "sequential" | "random" {
  const mode = cleanText(value).toLowerCase();
  if (mode === "random") return "random";
  return "sequential";
}

async function loadReceivingCategoryGroups(
  client: PoolClient,
  siteId: number,
  categoryCode: string
): Promise<string[]> {
  try {
    const r = await client.query<{ group_code: string }>(
      `SELECT group_code
       FROM wms_receiving_category_groups
       WHERE site_id = $1 AND category_code = $2
       ORDER BY sort_order, group_code`,
      [siteId, categoryCode]
    );
    const codes = r.rows.map((row) => row.group_code.trim()).filter(Boolean);
    return codes.length ? codes : DEFAULT_STICKERS_ITEM_GROUPS;
  } catch {
    return DEFAULT_STICKERS_ITEM_GROUPS;
  }
}

async function resolveWaitingSlotProfile(
  client: PoolClient,
  siteId: number,
  receivingCategoryCode: string
) {
  const groups = await loadReceivingCategoryGroups(client, siteId, receivingCategoryCode);
  return buildWaitingSlotProfile({
    receivingCategoryCode,
    allowedItemGroupCodes: groups,
  });
}

async function resolvePlacement(
  client: PoolClient,
  siteId: number,
  warehouseCode: string,
  zoneCode: string
): Promise<{ warehouseId: string; zoneId: string } | null> {
  const existing = await client.query<{ warehouseId: string; zoneId: string }>(
    `SELECT
       w.warehouse_id::text AS "warehouseId",
       z.zone_id::text AS "zoneId"
     FROM wms_warehouses w
     JOIN wms_zones z ON z.warehouse_id = w.warehouse_id
     WHERE w.site_id = $1
       AND w.warehouse_code = $2
       AND z.zone_code = $3
       AND w.is_active = TRUE
       AND z.is_active = TRUE`,
    [siteId, warehouseCode, zoneCode]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const wh = await client.query<{ warehouseId: string }>(
    `SELECT warehouse_id::text AS "warehouseId"
     FROM wms_warehouses
     WHERE site_id = $1 AND warehouse_code = $2 AND is_active = TRUE`,
    [siteId, warehouseCode]
  );
  if (wh.rows.length === 0) return null;

  const zoneName = ZONE_LABELS[zoneCode] ?? zoneCode;
  const created = await client.query<{ zoneId: string }>(
    `INSERT INTO wms_zones (warehouse_id, zone_code, name, is_active)
     VALUES ($1::bigint, $2, $3, TRUE)
     ON CONFLICT (warehouse_id, zone_code) DO UPDATE SET is_active = TRUE
     RETURNING zone_id::text AS "zoneId"`,
    [wh.rows[0].warehouseId, zoneCode, zoneName]
  );

  return { warehouseId: wh.rows[0].warehouseId, zoneId: created.rows[0].zoneId };
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

  let body: WaitingBatchBody;
  try {
    body = (await req.json()) as WaitingBatchBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = cleanText(body.siteCode);
  const warehouseCode = cleanText(body.warehouseCode);
  const zoneCode = cleanText(body.zoneCode);
  const count = parseCount(body.count);
  const startIndex = parseStartIndex(body.startIndex);
  const namingMode = parseNamingMode(body.namingMode);
  const namePrefix = cleanText(body.namePrefix) || undefined;
  const receivingCategoryCode =
    cleanText(body.receivingCategoryCode) || DEFAULT_RECEIVING_CATEGORY_CODE;

  let codePrefix: string;
  try {
    codePrefix = sanitizeWaitingCodePrefix(cleanText(body.codePrefix) || "A");
  } catch {
    return NextResponse.json({ error: "codePrefix contains unsupported characters" }, { status: 400 });
  }

  if (!siteCode || !warehouseCode || !zoneCode || count < 1) {
    return NextResponse.json(
      {
        error: `siteCode, warehouseCode, zoneCode and count (1..${MAX_WAITING_BATCH_COUNT}) are required`,
      },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const placement = await resolvePlacement(client, siteId, warehouseCode, zoneCode);
    if (!placement) {
      return NextResponse.json({ error: "active warehouse not found" }, { status: 404 });
    }

    const status = await client.query<{ locationStatusId: number; accuracyStatusId: number }>(
      `SELECT
         COALESCE(
           (SELECT location_status_id FROM ref_wms_location_status WHERE code IN ('AVAILABLE', 'ACTIVE') ORDER BY code = 'AVAILABLE' DESC LIMIT 1),
           (SELECT MIN(location_status_id) FROM ref_wms_location_status)
         )::int AS "locationStatusId",
         COALESCE(
           (SELECT accuracy_status_id FROM ref_wms_accuracy_status WHERE code IN ('UNVERIFIED', 'UNKNOWN', 'OK') ORDER BY code = 'UNVERIFIED' DESC LIMIT 1),
           (SELECT MIN(accuracy_status_id) FROM ref_wms_accuracy_status)
         )::int AS "accuracyStatusId"`
    );

    const slotProfile = await resolveWaitingSlotProfile(client, siteId, receivingCategoryCode);
    const attrsJson = mergeSlotIntoLocationAttrs(null, slotProfile);
    const created: Array<{
      locationCode: string;
      displayName: string;
      warehouseCode: string;
      zoneCode: string;
      isWaitingPoint: boolean;
      isEmpty: boolean;
    }> = [];

    if (namingMode === "sequential") {
      for (let i = 0; i < count; i += 1) {
        const index = startIndex + i;
        const locationCode = buildSequentialWaitingCellCode(codePrefix, index);
        const displayName =
          namePrefix != null
            ? `${namePrefix} ${index}`
            : sequentialWaitingDisplayName(codePrefix, index);
        const r = await client.query(
          `INSERT INTO wms_locations (
             site_id, warehouse_id, zone_id, location_code, display_name,
             location_status_id, accuracy_status_id, is_pick_face,
             location_attrs_json, updated_at
           ) VALUES ($1, $2::bigint, $3::bigint, $4, $5, $6, $7, FALSE, $8::jsonb, now())
           ON CONFLICT (site_id, location_code) DO NOTHING
           RETURNING location_code`,
          [
            siteId,
            placement.warehouseId,
            placement.zoneId,
            locationCode,
            displayName,
            status.rows[0].locationStatusId,
            status.rows[0].accuracyStatusId,
            JSON.stringify(attrsJson),
          ]
        );
        if (r.rows.length === 0) {
          return NextResponse.json(
            { error: `location code already exists: ${locationCode}`, created },
            { status: 409 }
          );
        }
        created.push({
          locationCode,
          displayName,
          warehouseCode,
          zoneCode,
          isWaitingPoint: true,
          isEmpty: true,
        });
      }
    } else {
      for (let i = 0; i < count; i += 1) {
        let locationCode = "";
        let inserted = false;
        for (let attempt = 0; attempt < 8 && !inserted; attempt += 1) {
          locationCode = `${codePrefix}-${randomWaitingCellSuffix()}`;
          const displayName = randomWaitingDisplayName(namePrefix);
          const r = await client.query(
            `INSERT INTO wms_locations (
               site_id, warehouse_id, zone_id, location_code, display_name,
               location_status_id, accuracy_status_id, is_pick_face,
               location_attrs_json, updated_at
             ) VALUES ($1, $2::bigint, $3::bigint, $4, $5, $6, $7, FALSE, $8::jsonb, now())
             ON CONFLICT (site_id, location_code) DO NOTHING
             RETURNING location_code`,
            [
              siteId,
              placement.warehouseId,
              placement.zoneId,
              locationCode,
              displayName,
              status.rows[0].locationStatusId,
              status.rows[0].accuracyStatusId,
              JSON.stringify(attrsJson),
            ]
          );
          if (r.rows.length > 0) {
            created.push({
              locationCode,
              displayName,
              warehouseCode,
              zoneCode,
              isWaitingPoint: true,
              isEmpty: true,
            });
            inserted = true;
          }
        }
        if (!inserted) {
          return NextResponse.json(
            { error: "failed to generate unique waiting cell codes", created },
            { status: 409 }
          );
        }
      }
    }

    return NextResponse.json({ locations: created, slotProfile }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/wms/locations/waiting-batch]", error);
    const message = error instanceof Error ? error.message : "internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

/** Обновить профиль у уже созданных точек ожидания (storagePurpose=WAITING). */
export async function PATCH(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: BackfillBody;
  try {
    body = (await req.json()) as BackfillBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = cleanText(body.siteCode);
  const warehouseCode = cleanText(body.warehouseCode) || undefined;
  const receivingCategoryCode =
    cleanText(body.receivingCategoryCode) || DEFAULT_RECEIVING_CATEGORY_CODE;

  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const slotProfile = await resolveWaitingSlotProfile(client, siteId, receivingCategoryCode);

    const rows = await client.query<{ location_code: string; location_attrs_json: unknown }>(
      `SELECT l.location_code, l.location_attrs_json
       FROM wms_locations l
       JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
       WHERE l.site_id = $1
         AND ($2::text IS NULL OR w.warehouse_code = $2)
         AND COALESCE(l.location_attrs_json->'slotProfile'->>'storagePurpose', '') = 'WAITING'`,
      [siteId, warehouseCode ?? null]
    );

    let updated = 0;
    for (const row of rows.rows) {
      const merged = mergeSlotIntoLocationAttrs(row.location_attrs_json, slotProfile);
      const prev = parseSlotProfileFromAttrs(row.location_attrs_json);
      const prevJson = JSON.stringify(mergeSlotIntoLocationAttrs(null, prev).slotProfile);
      const nextJson = JSON.stringify(merged.slotProfile);
      if (prevJson === nextJson) continue;
      await client.query(
        `UPDATE wms_locations
         SET location_attrs_json = $3::jsonb, updated_at = now()
         WHERE site_id = $1 AND location_code = $2`,
        [siteId, row.location_code, JSON.stringify(merged)]
      );
      updated += 1;
    }

    return NextResponse.json({ updated, slotProfile, totalWaiting: rows.rows.length });
  } catch (error) {
    console.error("[PATCH /api/wms/locations/waiting-batch]", error);
    const message = error instanceof Error ? error.message : "internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
