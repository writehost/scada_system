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
  const fieldKey = url.searchParams.get("fieldKey")?.trim() ?? "";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (fieldKey && !isSlotProfileFieldKey(fieldKey)) {
    return NextResponse.json({ error: "unknown fieldKey" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const params: unknown[] = [siteId];
    let fieldFilter = "";
    if (fieldKey) {
      params.push(fieldKey);
      fieldFilter = ` AND field_key = $2`;
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
      SELECT
        field_key,
        option_code,
        name,
        description,
        sort_order,
        is_active,
        created_at::text,
        updated_at::text
      FROM wms_slot_profile_option_defs
      WHERE site_id = $1${fieldFilter}
      ORDER BY field_key, sort_order, option_code
      `,
      params
    );
    return NextResponse.json({
      options: result.rows.map((row) => rowToDto(row)),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "query failed";
    if (msg.includes("wms_slot_profile_option_defs") || msg.includes("does not exist")) {
      return NextResponse.json({ options: [] });
    }
    console.error("[directories/slot-profile-options GET]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}

type PostBody = {
  siteCode?: string;
  fieldKey?: string;
  code?: string;
  name?: string;
  description?: string | null;
  sortOrder?: number;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const fieldKey = (body.fieldKey ?? "").trim();
  const rawCode = (body.code ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!isSlotProfileFieldKey(fieldKey)) {
    return NextResponse.json({ error: "fieldKey is required" }, { status: 400 });
  }
  if (!rawCode) return NextResponse.json({ error: "code is required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const code = rawCode.toUpperCase().replace(/\s+/g, "-");
  if (!/^[A-Z0-9_-]{1,64}$/.test(code)) {
    return NextResponse.json(
      { error: "code: только A–Z, цифры, - и _, до 64 символов" },
      { status: 400 }
    );
  }

  const sortOrder =
    typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
      ? Math.trunc(body.sortOrder)
      : 100;
  const description = body.description == null ? null : String(body.description).trim() || null;

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const ins = await client.query<{
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
      INSERT INTO wms_slot_profile_option_defs (
        site_id, field_key, option_code, name, description, sort_order, is_active, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, now(), now())
      ON CONFLICT (site_id, field_key, option_code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        sort_order = EXCLUDED.sort_order,
        is_active = TRUE,
        updated_at = now()
      RETURNING
        field_key, option_code, name, description, sort_order, is_active,
        created_at::text, updated_at::text
      `,
      [siteId, fieldKey, code, name, description, sortOrder]
    );
    const row = ins.rows[0];
    if (!row) return NextResponse.json({ error: "insert failed" }, { status: 500 });
    return NextResponse.json({ option: rowToDto(row) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("wms_slot_profile_option_defs") || msg.includes("does not exist")) {
      return NextResponse.json(
        { error: "таблица справочника не создана — выполните миграцию БД" },
        { status: 503 }
      );
    }
    console.error("[directories/slot-profile-options POST]", e);
    return NextResponse.json({ error: msg || "insert failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
