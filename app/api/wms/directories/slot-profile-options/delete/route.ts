import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { isSlotProfileFieldKey } from "@/lib/wms/slot-profile-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeleteBody = {
  siteCode?: string;
  fieldKey?: string;
  code?: string;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const fieldKey = (body.fieldKey ?? "").trim();
  const code = (body.code ?? "").trim().toUpperCase();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!isSlotProfileFieldKey(fieldKey)) return NextResponse.json({ error: "fieldKey is required" }, { status: 400 });
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const result = await client.query(
      `
      DELETE FROM wms_slot_profile_option_defs
      WHERE site_id = $1 AND field_key = $2 AND option_code = $3
      `,
      [siteId, fieldKey, code]
    );
    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, fieldKey, code });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    console.error("[directories/slot-profile-options/delete POST]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
