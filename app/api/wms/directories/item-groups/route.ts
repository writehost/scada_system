import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import {
  applyGroupShelfLifeToItems,
  ensureItemGroupsShelfLifeColumn,
  seedStickersGroupShelfLifeDefault,
} from "@/lib/wms/stickers-group-shelf-life";
import type { PoolClient } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ItemGroupBody = {
  siteCode?: string;
  code?: string;
  name?: string;
  description?: string | null;
  imageUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  defaultShelfLifeDays?: number | null;
  applyShelfLifeToItems?: boolean;
};

async function mapGroup(client: PoolClient, siteId: number, code: string) {
  const r = await client.query(
    `SELECT
       g.group_code AS code,
       g.group_code AS "productGroup",
       g.name,
       g.description,
       g.image_url AS "imageUrl",
       COALESCE(g.sort_order, 100)::int AS "sortOrder",
       COALESCE(g.is_active, TRUE) AS "isActive",
       g.default_shelf_life_days AS "defaultShelfLifeDays",
       g.created_at AS "createdAt",
       g.updated_at AS "updatedAt",
       COUNT(i.item_id)::int AS "itemCount",
       COUNT(i.item_id) FILTER (WHERE COALESCE(sb.available_qty, 0) > 0)::int AS "withStockCount",
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1
         FROM wms_item_specs s
         WHERE s.site_id = g.site_id AND s.parent_item_id = i.item_id AND s.is_active
       ))::int AS "withActiveSpecCount"
     FROM wms_item_groups g
     LEFT JOIN wms_items i ON (
       i.site_id = g.site_id
       AND (
         i.item_group_code = g.group_code
         OR i.product_group = g.group_code
         OR btrim(i.product_group) = btrim(g.name)
       )
     )
     LEFT JOIN wms_stock_balances sb ON sb.site_id = i.site_id AND sb.item_id = i.item_id
     WHERE g.site_id = $1 AND g.group_code = $2
     GROUP BY g.group_code, g.name, g.description, g.image_url, g.sort_order, g.is_active, g.default_shelf_life_days, g.created_at, g.updated_at`,
    [siteId, code]
  );
  return r.rows[0] ?? null;
}

async function resolveSite(client: PoolClient, siteCode: string) {
  const siteId = await getSiteId(client, siteCode);
  if (siteId == null) {
    throw new Response(JSON.stringify({ error: "unknown siteCode" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  return siteId;
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

  const conn = await tryConnect(pool);
  if (!conn.ok) {
    return NextResponse.json(
      { error: conn.message, code: conn.code },
      { status: conn.status }
    );
  }

  const client = conn.client;
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    await ensureItemGroupsShelfLifeColumn(client);
    await seedStickersGroupShelfLifeDefault(client, siteId);

    const r = await client.query(
      `SELECT
         g.group_code AS code,
         g.group_code AS "productGroup",
         g.name,
         g.description,
         g.image_url AS "imageUrl",
         COALESCE(g.sort_order, 100)::int AS "sortOrder",
         COALESCE(g.is_active, TRUE) AS "isActive",
         g.created_at AS "createdAt",
         g.updated_at AS "updatedAt",
         COUNT(i.item_id)::int AS "itemCount",
         COUNT(i.item_id) FILTER (WHERE COALESCE(sb.available_qty, 0) > 0)::int AS "withStockCount",
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1
           FROM wms_item_specs s
           WHERE s.site_id = g.site_id AND s.parent_item_id = i.item_id AND s.is_active
         ))::int AS "withActiveSpecCount"
       FROM wms_item_groups g
       LEFT JOIN wms_items i ON (
         i.site_id = g.site_id
         AND (
           i.item_group_code = g.group_code
           OR i.product_group = g.group_code
           OR btrim(i.product_group) = btrim(g.name)
         )
       )
       LEFT JOIN wms_stock_balances sb ON sb.site_id = i.site_id AND sb.item_id = i.item_id
       WHERE g.site_id = $1
       GROUP BY g.group_code, g.name, g.description, g.image_url, g.sort_order, g.is_active, g.default_shelf_life_days, g.created_at, g.updated_at
       ORDER BY COALESCE(g.sort_order, 100), g.name, g.group_code`,
      [siteId]
    );

    return NextResponse.json({ groups: r.rows });
  } catch (e) {
    const err = e as { code?: string };
    if (err?.code === "42P01" || err?.code === "42703") {
      return NextResponse.json({ groups: [], tableMissing: true });
    }
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e), code: "db_query_failed" },
      { status: 500 }
    );
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
  let body: ItemGroupBody;
  try {
    body = (await req.json()) as ItemGroupBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = String(body.siteCode ?? "").trim();
  const code = String(body.code ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!siteCode || !code || !name) {
    return NextResponse.json({ error: "siteCode, code and name are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await resolveSite(client, siteCode);
    await ensureItemGroupsShelfLifeColumn(client);
    const defaultShelf =
      body.defaultShelfLifeDays != null && Number.isFinite(Number(body.defaultShelfLifeDays))
        ? Math.max(1, Math.trunc(Number(body.defaultShelfLifeDays)))
        : null;
    await client.query(
      `INSERT INTO wms_item_groups (site_id, group_code, name, description, image_url, sort_order, default_shelf_life_days, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, now())
       ON CONFLICT (site_id, group_code)
       DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         image_url = EXCLUDED.image_url,
         sort_order = EXCLUDED.sort_order,
         default_shelf_life_days = COALESCE(EXCLUDED.default_shelf_life_days, wms_item_groups.default_shelf_life_days),
         is_active = TRUE,
         updated_at = now()`,
      [
        siteId,
        code,
        name,
        body.description ?? null,
        body.imageUrl ?? null,
        Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
        defaultShelf,
      ]
    );
    if (body.applyShelfLifeToItems && defaultShelf) {
      await applyGroupShelfLifeToItems(client, siteId, code, defaultShelf);
    }
    return NextResponse.json({ group: await mapGroup(client, siteId, code) });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e), code: "db_query_failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

export async function PATCH(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  let body: ItemGroupBody;
  try {
    body = (await req.json()) as ItemGroupBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = String(body.siteCode ?? "").trim();
  const code = String(body.code ?? "").trim();
  if (!siteCode || !code) {
    return NextResponse.json({ error: "siteCode and code are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await resolveSite(client, siteCode);
    await ensureItemGroupsShelfLifeColumn(client);
    const current = await mapGroup(client, siteId, code);
    if (!current) return NextResponse.json({ error: "group not found" }, { status: 404 });
    const defaultShelf =
      "defaultShelfLifeDays" in body
        ? body.defaultShelfLifeDays == null
          ? null
          : Math.max(1, Math.trunc(Number(body.defaultShelfLifeDays)))
        : (current.defaultShelfLifeDays as number | null | undefined);
    await client.query(
      `UPDATE wms_item_groups SET
         name = COALESCE($3, name),
         description = $4,
         image_url = $5,
         sort_order = COALESCE($6, sort_order),
         is_active = COALESCE($7, is_active),
         default_shelf_life_days = $8,
         updated_at = now()
       WHERE site_id = $1 AND group_code = $2`,
      [
        siteId,
        code,
        typeof body.name === "string" && body.name.trim() ? body.name.trim() : null,
        "description" in body ? body.description ?? null : current.description ?? null,
        "imageUrl" in body ? body.imageUrl ?? null : current.imageUrl ?? null,
        Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : null,
        typeof body.isActive === "boolean" ? body.isActive : null,
        "defaultShelfLifeDays" in body ? defaultShelf : current.defaultShelfLifeDays ?? null,
      ]
    );
    if (body.applyShelfLifeToItems && defaultShelf) {
      await applyGroupShelfLifeToItems(client, siteId, code, defaultShelf);
    }
    return NextResponse.json({ group: await mapGroup(client, siteId, code) });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e), code: "db_query_failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

export async function DELETE(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!siteCode.trim() || !code.trim()) {
    return NextResponse.json({ error: "siteCode and code are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await resolveSite(client, siteCode);
    const used = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM wms_items
       WHERE site_id = $1 AND (item_group_code = $2 OR product_group = $2)`,
      [siteId, code.trim()]
    );
    const usedCount = Number(used.rows[0]?.count ?? "0");
    if (usedCount > 0) {
      await client.query(
        `UPDATE wms_item_groups SET is_active = FALSE, updated_at = now()
         WHERE site_id = $1 AND group_code = $2`,
        [siteId, code.trim()]
      );
      return NextResponse.json({
        ok: true,
        mode: "disabled",
        usedCount,
        group: await mapGroup(client, siteId, code.trim()),
      });
    }
    await client.query(`DELETE FROM wms_item_groups WHERE site_id = $1 AND group_code = $2`, [siteId, code.trim()]);
    return NextResponse.json({ ok: true, mode: "deleted", usedCount: 0 });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e), code: "db_query_failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
