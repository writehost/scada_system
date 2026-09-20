import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { isSlotProfileFieldKey } from "@/lib/wms/slot-profile-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rowToDto(r: {
  field_key: string;
  option_code: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}) {
  return {
    fieldKey: r.field_key,
    code: r.option_code,
    name: r.name,
    description: r.description,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ fieldKey: string; code: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const { fieldKey: rawFieldKey, code } = await ctx.params;
  const fieldKey = decodeURIComponent(rawFieldKey).trim();
  const optionCode = decodeURIComponent(code).trim();
  if (!isSlotProfileFieldKey(fieldKey)) {
    return NextResponse.json({ error: "unknown fieldKey" }, { status: 400 });
  }

  let body: {
    siteCode?: string;
    name?: string;
    description?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const sets: string[] = ["updated_at = now()"];
    const params: unknown[] = [siteId, fieldKey, optionCode];
    let idx = 4;

    if (typeof body.name === "string" && body.name.trim()) {
      sets.push(`name = $${idx++}`);
      params.push(body.name.trim());
    }
    if (body.description !== undefined) {
      sets.push(`description = $${idx++}`);
      params.push(body.description == null ? null : String(body.description).trim() || null);
    }
    if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) {
      sets.push(`sort_order = $${idx++}`);
      params.push(Math.trunc(body.sortOrder));
    }
    if (typeof body.isActive === "boolean") {
      sets.push(`is_active = $${idx++}`);
      params.push(body.isActive);
    }

    if (sets.length === 1) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const result = await client.query<{
      field_key: string;
      option_code: string;
      name: string;
      description: string | null;
      sort_order: number;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `
      UPDATE wms_slot_profile_option_defs
      SET ${sets.join(", ")}
      WHERE site_id = $1 AND field_key = $2 AND option_code = $3
      RETURNING
        field_key, option_code, name, description, sort_order, is_active,
        created_at::text, updated_at::text
      `,
      params
    );
    const row = result.rows[0];
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ option: rowToDto(row) });
  } finally {
    client.release();
  }
}
