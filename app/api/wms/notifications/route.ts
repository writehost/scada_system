import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BroadcastBody = {
  siteCode?: string;
  title?: string;
  body?: string;
  severity?: string;
  target?: "all" | "users";
  userIds?: string[];
  createdByUserId?: string | null;
};

async function resolveCurrentUserId(
  client: PoolClient,
  siteId: number,
  requestedUserId: string
) {
  if (requestedUserId.trim()) return Number(requestedUserId);
  const first = await client.query<{ userId: string }>(
    `SELECT user_id::text AS "userId" FROM wms_users WHERE site_id = $1 AND is_active ORDER BY user_id LIMIT 1`,
    [siteId]
  );
  return Number(first.rows[0]?.userId ?? "0");
}

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const userIdParam = url.searchParams.get("userId") ?? "";
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const userId = await resolveCurrentUserId(client, siteId, userIdParam);
    if (!userId) return NextResponse.json({ notifications: [], unreadCount: 0, currentUserId: null });

    const result = await client.query(
      `
      SELECT
        n.notification_id::text AS "notificationId",
        n.title,
        n.body,
        n.severity,
        n.created_at AS "createdAt",
        nr.read_at AS "readAt"
      FROM wms_notification_recipients nr
      JOIN wms_notifications n ON n.notification_id = nr.notification_id
      WHERE n.site_id = $1 AND nr.user_id = $2
      ORDER BY n.created_at DESC
      LIMIT 50
      `,
      [siteId, userId]
    );

    return NextResponse.json({
      notifications: result.rows,
      unreadCount: result.rows.filter((row: { readAt?: string | null }) => !row.readAt).length,
      currentUserId: String(userId),
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "42P01") {
      return NextResponse.json({ error: "notification tables are missing; run database migration" }, { status: 503 });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });

  let body: BroadcastBody;
  try {
    body = (await req.json()) as BroadcastBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message = typeof body.body === "string" ? body.body.trim() : "";
  const severity = typeof body.severity === "string" ? body.severity.trim() || "info" : "info";
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!title || !message) return NextResponse.json({ error: "title and body are required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const target = body.target === "users" ? "users" : "all";
    const requestedIds = Array.isArray(body.userIds) ? body.userIds.map((id) => Number(id)).filter(Number.isFinite) : [];
    const users = target === "users" && requestedIds.length > 0
      ? await client.query<{ userId: string }>(
          `SELECT user_id::text AS "userId" FROM wms_users WHERE site_id = $1 AND is_active AND user_id = ANY($2::bigint[])`,
          [siteId, requestedIds]
        )
      : await client.query<{ userId: string }>(
          `SELECT user_id::text AS "userId" FROM wms_users WHERE site_id = $1 AND is_active`,
          [siteId]
        );

    if (users.rows.length === 0) return NextResponse.json({ error: "no active recipients" }, { status: 400 });

    await client.query("BEGIN");
    const created = await client.query<{ notificationId: string }>(
      `
      INSERT INTO wms_notifications (site_id, title, body, severity, created_by_user_id)
      VALUES ($1, $2, $3, $4, NULLIF($5::text, '')::bigint)
      RETURNING notification_id::text AS "notificationId"
      `,
      [siteId, title, message, severity, body.createdByUserId ?? ""]
    );
    const notificationId = created.rows[0]?.notificationId;
    for (const user of users.rows) {
      await client.query(
        `INSERT INTO wms_notification_recipients (notification_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [notificationId, user.userId]
      );
    }
    await client.query("COMMIT");

    return NextResponse.json({ notificationId, recipientCount: users.rows.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "42P01") {
      return NextResponse.json({ error: "notification tables are missing; run database migration" }, { status: 503 });
    }
    throw error;
  } finally {
    client.release();
  }
}
