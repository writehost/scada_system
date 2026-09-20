import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });

  const { id } = await params;
  let body: { siteCode?: string; userId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  const userId = Number(body.userId || "0");
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    await client.query(
      `
      UPDATE wms_notification_recipients nr
      SET read_at = COALESCE(read_at, now())
      FROM wms_notifications n
      WHERE n.notification_id = nr.notification_id
        AND n.site_id = $1
        AND nr.notification_id = $2::bigint
        AND nr.user_id = $3::bigint
      `,
      [siteId, id, userId]
    );
    return NextResponse.json({ ok: true });
  } finally {
    client.release();
  }
}
