import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import type { PoolClient } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CategoryBody = {
  siteCode?: string;
  code?: string;
  name?: string;
  description?: string | null;
  imageUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  linkedGroupCodes?: string[];
};

async function linkedGroupCodes(client: PoolClient, siteId: number, categoryCode: string) {
  const r = await client.query<{ group_code: string }>(
    `SELECT group_code
     FROM wms_receiving_category_groups
     WHERE site_id = $1 AND category_code = $2
     ORDER BY sort_order, group_code`,
    [siteId, categoryCode]
  );
  return r.rows.map((row) => row.group_code);
}

async function mapCategory(client: PoolClient, siteId: number, code: string) {
  const r = await client.query(
    `SELECT
       c.category_code AS code,
       c.name,
       c.description,
       c.image_url AS "imageUrl",
       COALESCE(c.sort_order, 100)::int AS "sortOrder",
       COALESCE(c.is_active, TRUE) AS "isActive",
       c.created_at AS "createdAt",
       c.updated_at AS "updatedAt"
     FROM wms_receiving_categories c
     WHERE c.site_id = $1 AND c.category_code = $2`,
    [siteId, code]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    ...row,
    linkedGroupCodes: await linkedGroupCodes(client, siteId, code),
  };
}

async function replaceLinkedGroups(
  client: PoolClient,
  siteId: number,
  categoryCode: string,
  codes: string[]
) {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  await client.query(
    `DELETE FROM wms_receiving_category_groups WHERE site_id = $1 AND category_code = $2`,
    [siteId, categoryCode]
  );
  for (let i = 0; i < unique.length; i++) {
    const groupCode = unique[i];
    await client.query(
      `INSERT INTO wms_receiving_category_groups (site_id, category_code, group_code, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (site_id, category_code, group_code) DO NOTHING`,
      [siteId, categoryCode, groupCode, (i + 1) * 10]
    );
  }
}

const DEFAULT_CATEGORY_GROUPS: Record<string, string[]> = {
  stickers: ["stickers", "labels", "Стикеры Скит", "Стикеры ПМВ", "Этикетки Скит", "Этикетки ПМВ"],
  water: ["water", "softdrinks", "Вода", "Напитки Славда"],
  MaterialsFactory: [
    "Картон",
    "Преформа",
    "Колпачок, ручка",
    "Прочее сырье и материалы",
    "Эмульсия",
    "Отходы, полуфабрикаты от производства Скита",
  ],
};

async function seedReceivingCategoryLinks(client: PoolClient, siteId: number) {
  for (const [category, groups] of Object.entries(DEFAULT_CATEGORY_GROUPS)) {
    const existing = await linkedGroupCodes(client, siteId, category);
    if (existing.length > 0) continue;
    const present = await client.query<{ group_code: string }>(
      `SELECT group_code FROM wms_item_groups WHERE site_id = $1 AND group_code = ANY($2::text[])`,
      [siteId, groups]
    );
    if (present.rows.length === 0) continue;
    await replaceLinkedGroups(
      client,
      siteId,
      category,
      present.rows.map((row) => row.group_code)
    );
  }
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

    await seedReceivingCategoryLinks(client, siteId);

    const r = await client.query(
      `SELECT
         c.category_code AS code,
         c.name,
         c.description,
         c.image_url AS "imageUrl",
         COALESCE(c.sort_order, 100)::int AS "sortOrder",
         COALESCE(c.is_active, TRUE) AS "isActive",
         c.created_at AS "createdAt",
         c.updated_at AS "updatedAt"
       FROM wms_receiving_categories c
       WHERE c.site_id = $1
       ORDER BY COALESCE(c.sort_order, 100), c.name, c.category_code`,
      [siteId]
    );

    const categories = [];
    for (const row of r.rows) {
      categories.push({
        ...row,
        linkedGroupCodes: await linkedGroupCodes(client, siteId, row.code as string),
      });
    }

    return NextResponse.json({ categories });
  } catch (e) {
    const err = e as { code?: string };
    if (err?.code === "42P01" || err?.code === "42703") {
      return NextResponse.json({ categories: [], tableMissing: true });
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
  let body: CategoryBody;
  try {
    body = (await req.json()) as CategoryBody;
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
    await client.query(
      `INSERT INTO wms_receiving_categories (site_id, category_code, name, description, image_url, sort_order, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, now())
       ON CONFLICT (site_id, category_code)
       DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         image_url = EXCLUDED.image_url,
         sort_order = EXCLUDED.sort_order,
         is_active = TRUE,
         updated_at = now()`,
      [
        siteId,
        code,
        name,
        body.description ?? null,
        body.imageUrl ?? null,
        Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
      ]
    );
    if (Array.isArray(body.linkedGroupCodes)) {
      await replaceLinkedGroups(client, siteId, code, body.linkedGroupCodes);
    }
    return NextResponse.json({ category: await mapCategory(client, siteId, code) });
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
  let body: CategoryBody;
  try {
    body = (await req.json()) as CategoryBody;
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
    const current = await mapCategory(client, siteId, code);
    if (!current) return NextResponse.json({ error: "category not found" }, { status: 404 });
    await client.query(
      `UPDATE wms_receiving_categories SET
         name = COALESCE($3, name),
         description = $4,
         image_url = $5,
         sort_order = COALESCE($6, sort_order),
         is_active = COALESCE($7, is_active),
         updated_at = now()
       WHERE site_id = $1 AND category_code = $2`,
      [
        siteId,
        code,
        typeof body.name === "string" && body.name.trim() ? body.name.trim() : null,
        "description" in body ? body.description ?? null : current.description ?? null,
        "imageUrl" in body ? body.imageUrl ?? null : current.imageUrl ?? null,
        Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : null,
        typeof body.isActive === "boolean" ? body.isActive : null,
      ]
    );
    if (Array.isArray(body.linkedGroupCodes)) {
      await replaceLinkedGroups(client, siteId, code, body.linkedGroupCodes);
    }
    return NextResponse.json({ category: await mapCategory(client, siteId, code) });
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
    const current = await mapCategory(client, siteId, code.trim());
    if (!current) return NextResponse.json({ error: "category not found" }, { status: 404 });
    await client.query(
      `UPDATE wms_receiving_categories SET is_active = FALSE, updated_at = now()
       WHERE site_id = $1 AND category_code = $2`,
      [siteId, code.trim()]
    );
    return NextResponse.json({
      ok: true,
      mode: "disabled",
      category: await mapCategory(client, siteId, code.trim()),
    });
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
