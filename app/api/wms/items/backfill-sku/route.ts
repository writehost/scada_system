import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireWmsSession } from "@/lib/wms/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * POST /api/wms/items/backfill-sku
 * body: { siteCode, dryRun?: boolean, limit?: number }
 *
 * SKU алгоритм: GTIN14 -> `<prefix11>-<rest3>`
 * GTIN14 извлекаем из `wms_items.nomenclature` как `01` + 14 цифр.
 */
export async function POST(req: Request) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const siteCode = typeof b.siteCode === "string" ? b.siteCode.trim() : "";
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const dryRun = b.dryRun === true;
  const limit = safeInt(b.limit, 50, 1, 1000);

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    // Берём кандидатов: sku пустой, есть nomenclature, в котором встречается 01 + 14 цифр.
    const candidates = await client.query<{
      itemCode: string;
      gtin14: string;
      nextSku: string;
    }>(
      `WITH c AS (
         SELECT
           i.item_code AS "itemCode",
           substring(i.nomenclature from '01([0-9]{14})') AS gtin14
         FROM wms_items i
         WHERE i.site_id = $1
           AND COALESCE(btrim(i.sku), '') = ''
           AND COALESCE(i.nomenclature, '') <> ''
           AND i.nomenclature ~ '01[0-9]{14}'
         ORDER BY i.item_id DESC
         LIMIT $2
       )
       SELECT
         c."itemCode",
         c.gtin14,
         (substring(c.gtin14 from 1 for 11) || '-' || substring(c.gtin14 from 12)) AS "nextSku"
       FROM c
       WHERE c.gtin14 IS NOT NULL`,
      [siteId, limit]
    );

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        limit,
        count: candidates.rows.length,
        items: candidates.rows,
      });
    }

    await client.query("BEGIN");
    try {
      for (const row of candidates.rows) {
        await client.query(
          `UPDATE wms_items
           SET sku = $3, updated_at = now()
           WHERE site_id = $1 AND item_code = $2 AND COALESCE(btrim(sku), '') = ''`,
          [siteId, row.itemCode, row.nextSku]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    }

    return NextResponse.json({
      dryRun: false,
      limit,
      updated: candidates.rows.length,
      items: candidates.rows,
    });
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

