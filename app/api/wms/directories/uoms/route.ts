import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rowToDto(r: {
  uom_code: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}) {
  return {
    code: r.uom_code,
    name: r.name,
    description: r.description,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

type UomBody = {
  siteCode?: string;
  code?: string;
  name?: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

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

    const result = await client.query<{
      uom_code: string;
      name: string;
      description: string | null;
      sort_order: number;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT
         uom_code,
         name,
         description,
         sort_order,
         is_active,
         created_at::text,
         updated_at::text
       FROM wms_uom_defs
       WHERE site_id = $1
       ORDER BY sort_order, uom_code`,
      [siteId]
    );

    return NextResponse.json({ uoms: result.rows.map(rowToDto) });
  } catch (e) {
    const err = e as { code?: string };
    if (err?.code === "42P01" || err?.code === "42703") {
      return NextResponse.json({ uoms: [], tableMissing: true });
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

  let body: UomBody;
  try {
    body = (await req.json()) as UomBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = String(body.siteCode ?? "").trim();
  const code = String(body.code ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  if (!siteCode || !code || !name) {
    return NextResponse.json({ error: "siteCode, code and name are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const result = await client.query<{
      uom_code: string;
      name: string;
      description: string | null;
      sort_order: number;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO wms_uom_defs (site_id, uom_code, name, description, sort_order, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, now())
       ON CONFLICT (site_id, uom_code)
       DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         sort_order = EXCLUDED.sort_order,
         is_active = TRUE,
         updated_at = now()
       RETURNING
         uom_code, name, description, sort_order, is_active,
         created_at::text, updated_at::text`,
      [
        siteId,
        code,
        name,
        body.description ?? null,
        Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
      ]
    );

    return NextResponse.json({ uom: rowToDto(result.rows[0]!) });
  } catch (e) {
    const err = e as { code?: string };
    if (err?.code === "42P01" || err?.code === "42703") {
      return NextResponse.json(
        { error: "таблица wms_uom_defs не создана — примените патч 2026-05-29_wms_uom_defs.sql" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e), code: "db_query_failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
