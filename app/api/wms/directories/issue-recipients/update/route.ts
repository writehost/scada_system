import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { patchIssueRecipientDef } from "@/lib/wms/issue-recipient-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateBody = {
  siteCode?: string;
  recipientCode?: string;
  displayName?: string;
  position?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

/** POST вместо PATCH /[recipientCode] — в production Next.js dynamic app routes отдают 500. */
export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const recipientCode = decodeURIComponent(body.recipientCode ?? "")
    .trim()
    .toUpperCase();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!recipientCode) {
    return NextResponse.json({ error: "recipientCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const recipient = await patchIssueRecipientDef(client, siteId, recipientCode, {
      displayName: body.displayName,
      position: body.position,
      sortOrder: body.sortOrder,
      isActive: body.isActive,
    });
    if (!recipient) {
      return NextResponse.json({ error: "not found or no fields to update" }, { status: 404 });
    }
    return NextResponse.json({ recipient });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("wms_issue_recipient_defs") || msg.includes("does not exist")) {
      return NextResponse.json(
        { error: "таблица справочника не создана — выполните миграцию БД" },
        { status: 503 }
      );
    }
    throw e;
  } finally {
    client.release();
  }
}
