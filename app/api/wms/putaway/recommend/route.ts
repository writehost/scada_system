import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId, resolveItemByCodeOrBarcode } from "@/lib/wms/resolve";
import { WmsHttpError } from "@/lib/wms/errors";
import type { PoolClient } from "pg";
import {
  describePhysicalBlock,
  extractItemPhysical,
  extractLocationPhysical,
  type ItemPutawayPhysical,
} from "@/lib/wms/putaway-physical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecommendationRow = {
  locationCode: string;
  score: number;
  forbidden: boolean;
  reason: string;
  details?: string | null;
};

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

async function loadItemPutawayContext(
  client: PoolClient,
  siteId: number,
  itemId: string
): Promise<{
  mergeLots: boolean;
  rotationPolicy: "fifo" | "fefo" | "manual";
  itemPhysical: ItemPutawayPhysical;
}> {
  const r = await client.query<{
    item_attrs_json: unknown;
    rotation_policy: string;
  }>(
    `SELECT item_attrs_json, rotation_policy FROM wms_items WHERE site_id = $1 AND item_id = $2::bigint`,
    [siteId, itemId]
  );
  const attrs = asObject(r.rows[0]?.item_attrs_json);
  const mergeLots = asBool(attrs?.mergeLots) ?? true;
  const rot = r.rows[0]?.rotation_policy?.trim() ?? "fifo";
  const rotationPolicy = rot === "fefo" || rot === "manual" || rot === "fifo" ? (rot as "fifo" | "fefo" | "manual") : "fifo";

  const vol = await client.query<{ volume_l: string | null }>(
    `SELECT volume_l::text AS volume_l FROM wms_item_uoms WHERE item_id = $1::bigint AND is_base = TRUE LIMIT 1`,
    [itemId]
  );
  const baseVol = vol.rows[0]?.volume_l != null ? Number(vol.rows[0].volume_l) : null;
  const itemPhysical = extractItemPhysical(r.rows[0]?.item_attrs_json, baseVol != null && Number.isFinite(baseVol) ? baseVol : null);

  return { mergeLots, rotationPolicy, itemPhysical };
}

type LocRow = {
  locationId: string;
  locationCode: string;
  locationAttrsJson: unknown;
  itemQty: number;
  otherSkuCount: number;
  hasSameLot: boolean;
  hasOtherLot: boolean;
  minLotExpiry: Date | null;
  minLotReceived: Date | null;
};

async function fetchLocationOccupied(
  client: PoolClient,
  siteId: number,
  locationIds: string[]
): Promise<Map<string, { qtySum: number; volSum: number }>> {
  const map = new Map<string, { qtySum: number; volSum: number }>();
  if (locationIds.length === 0) return map;

  const q = await client.query<{
    locationId: string;
    qtySum: number;
    volSum: number;
  }>(
    `
    SELECT
      sb.location_id::text AS "locationId",
      COALESCE(SUM(sb.available_qty), 0)::float8 AS "qtySum",
      COALESCE(SUM(
        sb.available_qty * GREATEST(
          COALESCE(NULLIF(TRIM(i.item_attrs_json->>'unitVolumeL'), '')::float8, 0),
          COALESCE(u.volume_l, 0),
          0
        )
      ), 0)::float8 AS "volSum"
    FROM wms_stock_balances sb
    JOIN wms_items i ON i.item_id = sb.item_id AND i.site_id = sb.site_id
    LEFT JOIN LATERAL (
      SELECT volume_l FROM wms_item_uoms u WHERE u.item_id = i.item_id AND u.is_base = TRUE LIMIT 1
    ) u ON TRUE
    WHERE sb.site_id = $1 AND sb.location_id = ANY($2::bigint[])
    GROUP BY sb.location_id
    `,
    [siteId, locationIds]
  );
  for (const row of q.rows) {
    map.set(row.locationId, { qtySum: row.qtySum, volSum: row.volSum });
  }
  return map;
}

async function recommendPutaway(
  client: PoolClient,
  siteId: number,
  input: {
    itemId: string;
    lotCode: string | null;
    mergeLots: boolean;
    rotationPolicy: "fifo" | "fefo" | "manual";
    itemPhysical: ItemPutawayPhysical;
    incomingQty: number;
    limit: number;
  }
): Promise<RecommendationRow[]> {
  const limit = Math.min(Math.max(input.limit || 5, 1), 20);
  const lotCode = input.lotCode?.trim() ? input.lotCode.trim() : null;
  const lotParam = lotCode ?? "__NOLOT__";

  const byItem = await client.query<LocRow>(
    `
    WITH item_locs AS (
      SELECT
        l.location_id::text AS "locationId",
        l.location_code AS "locationCode",
        l.location_attrs_json AS "locationAttrsJson",
        COALESCE(SUM(sb.available_qty), 0)::float8 AS "itemQty",
        COALESCE(COUNT(DISTINCT sb2.item_id), 0)::int AS "otherSkuCount",
        COALESCE(BOOL_OR(sl.lot_code = $3), FALSE) AS "hasSameLot",
        COALESCE(BOOL_OR(sl.lot_code IS NOT NULL AND sl.lot_code <> $3), FALSE) AS "hasOtherLot",
        MIN(sl.expiry_at) AS "minLotExpiry",
        MIN(sl.received_at) AS "minLotReceived"
      FROM wms_locations l
      JOIN wms_stock_balances sb
        ON sb.site_id = l.site_id AND sb.location_id = l.location_id AND sb.item_id = $2::bigint
      LEFT JOIN wms_stock_lots sl ON sl.balance_id = sb.balance_id
      LEFT JOIN wms_stock_balances sb2
        ON sb2.site_id = l.site_id AND sb2.location_id = l.location_id AND sb2.item_id <> $2::bigint
      WHERE l.site_id = $1
        AND l.location_status_id <> 2
      GROUP BY l.location_id, l.location_code, l.location_attrs_json
    )
    SELECT * FROM item_locs
    ORDER BY "itemQty" DESC, "otherSkuCount" ASC, "locationCode"
    LIMIT $4
    `,
    [siteId, input.itemId, lotParam, limit * 6]
  );

  const empty = await client.query<{
    locationId: string;
    locationCode: string;
    locationAttrsJson: unknown;
  }>(
    `
    SELECT
      l.location_id::text AS "locationId",
      l.location_code AS "locationCode",
      l.location_attrs_json AS "locationAttrsJson"
    FROM wms_locations l
    LEFT JOIN wms_stock_balances sb ON sb.site_id = l.site_id AND sb.location_id = l.location_id
    WHERE l.site_id = $1
      AND l.location_status_id <> 2
    GROUP BY l.location_id, l.location_code, l.location_attrs_json
    HAVING COUNT(sb.balance_id) = 0
    ORDER BY l.location_code
    LIMIT $2
    `,
    [siteId, limit * 4]
  );

  const allIds = [...new Set([...byItem.rows.map((r) => r.locationId), ...empty.rows.map((e) => e.locationId)])];
  const occ = await fetchLocationOccupied(client, siteId, allIds);

  const built: RecommendationRow[] = [];

  const pushRow = (
    locationCode: string,
    score: number,
    forbidden: boolean,
    reason: string,
    details: string[]
  ) => {
    built.push({
      locationCode,
      score,
      forbidden,
      reason,
      details: details.filter(Boolean).join(" · ") || null,
    });
  };

  for (const r of byItem.rows) {
    let forbidden = false;
    let score = 0;
    let reason = "Адрес с тем же товаром";
    const details: string[] = [];
    details.push(`остаток SKU: ${r.itemQty}`);
    if (lotCode) {
      if (r.hasSameLot) {
        score += 100;
        reason = "Рекомендуется: здесь уже есть эта партия";
      } else {
        score += 60;
        reason = "Рекомендуется: здесь уже есть этот товар";
      }
      if (!input.mergeLots && r.hasOtherLot) {
        forbidden = true;
        score -= 1000;
        reason = "Запрещено: в ячейке другая партия этого товара";
      }
    } else {
      score += 70;
    }
    if (r.otherSkuCount === 0) score += 15;
    else details.push(`других SKU: ${r.otherSkuCount}`);

    const locPhys = extractLocationPhysical(r.locationAttrsJson);
    const metrics = occ.get(r.locationId) ?? { qtySum: 0, volSum: 0 };
    const phys = describePhysicalBlock(
      input.itemPhysical,
      locPhys,
      metrics.volSum,
      metrics.qtySum,
      input.incomingQty
    );
    if (phys.note) details.push(phys.note);
    if (phys.forbidden) forbidden = true;
    score += phys.scorePenalty;

    pushRow(r.locationCode, score, forbidden, reason, details);
  }

  if (byItem.rows.length === 0) {
    for (const e of empty.rows) {
      const locPhys = extractLocationPhysical(e.locationAttrsJson);
      const metrics = occ.get(e.locationId) ?? { qtySum: 0, volSum: 0 };
      const phys = describePhysicalBlock(input.itemPhysical, locPhys, metrics.volSum, metrics.qtySum, input.incomingQty);
      const details: string[] = [];
      if (phys.note) details.push(phys.note);
      pushRow(
        e.locationCode,
        10 + phys.scorePenalty,
        phys.forbidden,
        phys.forbidden ? "Нельзя по ВГХ/ёмкости" : "Свободная ячейка (пустая по остаткам)",
        details
      );
    }
    built.sort((a, b) => b.score - a.score || a.locationCode.localeCompare(b.locationCode));
    return built.slice(0, limit);
  }

  /** FIFO / FEFO: усилить адреса с «лучшей» партийной вилкой для отбора. */
  const withItem = byItem.rows.filter((r) => r.itemQty > 0);
  if (input.rotationPolicy === "fefo" && withItem.length > 0) {
    const expiries = withItem
      .map((r) => (r.minLotExpiry ? new Date(r.minLotExpiry).getTime() : null))
      .filter((t): t is number => t != null);
    if (expiries.length > 0) {
      const globalMin = Math.min(...expiries);
      for (const row of built) {
        const loc = withItem.find((x) => x.locationCode === row.locationCode);
        if (!loc?.minLotExpiry) continue;
        if (new Date(loc.minLotExpiry).getTime() === globalMin) {
          row.score += 25;
          if (!row.details?.includes("FEFO")) {
            row.details = row.details ? `${row.details} · FEFO: ближайший срок среди кандидатов` : "FEFO: ближайший срок среди кандидатов";
          }
        }
      }
    }
  } else if (input.rotationPolicy === "fifo" && withItem.length > 0) {
    const received = withItem
      .map((r) => (r.minLotReceived ? new Date(r.minLotReceived).getTime() : null))
      .filter((t): t is number => t != null);
    if (received.length > 0) {
      const globalMax = Math.max(...received);
      for (const row of built) {
        const loc = withItem.find((x) => x.locationCode === row.locationCode);
        if (!loc?.minLotReceived) continue;
        if (new Date(loc.minLotReceived).getTime() === globalMax) {
          row.score += 25;
          if (!row.details?.includes("FIFO")) {
            row.details = row.details ? `${row.details} · FIFO: старая партия (дата поступления)` : "FIFO: старая партия (дата поступления)";
          }
        }
      }
    }
  }

  for (const e of empty.rows) {
    if (built.some((b) => b.locationCode === e.locationCode)) continue;
    const locPhys = extractLocationPhysical(e.locationAttrsJson);
    const metrics = occ.get(e.locationId) ?? { qtySum: 0, volSum: 0 };
    const phys = describePhysicalBlock(input.itemPhysical, locPhys, metrics.volSum, metrics.qtySum, input.incomingQty);
    const details: string[] = [];
    if (phys.note) details.push(phys.note);
    pushRow(
      e.locationCode,
      8 + phys.scorePenalty,
      phys.forbidden,
      phys.forbidden ? "Нельзя по ВГХ/ёмкости" : "Свободная ячейка",
      details
    );
  }

  built.sort((a, b) => b.score - a.score || a.locationCode.localeCompare(b.locationCode));
  return built.slice(0, limit);
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
    itemCode?: string;
    lotCode?: string | null;
    limit?: number;
    qty?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  const itemCode = typeof body.itemCode === "string" ? body.itemCode.trim() : "";
  const lotCode = typeof body.lotCode === "string" ? body.lotCode.trim() : null;
  const limit = Number(body.limit ?? 7);
  const incomingQty = Number(body.qty ?? 1);
  const qty = Number.isFinite(incomingQty) && incomingQty > 0 ? incomingQty : 1;

  if (!siteCode || !itemCode) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 });
  }

  const probe = await pool.connect();
  try {
    const siteId = await getSiteId(probe, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const item = await resolveItemByCodeOrBarcode(probe, siteId, itemCode);
    if (!item) return NextResponse.json({ error: "item not found" }, { status: 404 });

    const ctx = await loadItemPutawayContext(probe, siteId, item.item_id);
    const recommendations = await recommendPutaway(probe, siteId, {
      itemId: item.item_id,
      lotCode,
      mergeLots: ctx.mergeLots,
      rotationPolicy: ctx.rotationPolicy,
      itemPhysical: ctx.itemPhysical,
      incomingQty: qty,
      limit: Number.isFinite(limit) ? limit : 7,
    });

    return NextResponse.json({
      itemCode: item.item_code,
      lotCode,
      policy: {
        mergeLots: ctx.mergeLots,
        rotationPolicy: ctx.rotationPolicy,
        unitVolumeL: ctx.itemPhysical.unitVolumeL,
        hasDims: Boolean(ctx.itemPhysical.dimsMmSorted),
      },
      recommendations,
    });
  } catch (e) {
    const err = e instanceof WmsHttpError ? e : null;
    if (err) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  } finally {
    probe.release();
  }
}
