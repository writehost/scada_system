import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
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

type PatchBody = {
  siteCode?: string;
  name?: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ uomCode: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const { uomCode: rawCode } = await ctx.params;
  const uomCode = decodeURIComponent(rawCode ?? "").trim().toLowerCase();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!uomCode) return NextResponse.json({ error: "uomCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (sql: string, v: unknown) => {
      vals.push(v);
      sets.push(`${sql} = $${vals.length}`);
    };

    if (typeof body.name === "string" && body.name.trim()) push("name", body.name.trim());
    if ("description" in body) {
      const d = body.description == null ? null : String(body.description).trim() || null;
      push("description", d);
    }
    if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) {
      push("sort_order", Math.trunc(body.sortOrder));
    }
    if (typeof body.isActive === "boolean") push("is_active", body.isActive);

    if (sets.length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }
    sets.push("updated_at = now()");
    const pSite = vals.length + 1;
    const pCode = vals.length + 2;
    const q = `
      UPDATE wms_uom_defs
      SET ${sets.join(", ")}
      WHERE site_id = $${pSite} AND LOWER(uom_code) = $${pCode}
      RETURNING
        uom_code, name, description, sort_order, is_active,
        created_at::text, updated_at::text
    `;
    const result = await client.query<{
      uom_code: string;
      name: string;
      description: string | null;
      sort_order: number;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(q, [...vals, siteId, uomCode]);

    const row = result.rows[0];
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ uom: rowToDto(row) });
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
