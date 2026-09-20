import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  createIssueRecipientDef,
  listIssueRecipientDefs,
  normalizeRecipientCode,
  recipientCodeFromDisplayName,
} from "@/lib/wms/issue-recipient-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const recipients = await listIssueRecipientDefs(client, siteId);
    return NextResponse.json({ recipients });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "query failed";
    if (msg.includes("wms_issue_recipient_defs") || msg.includes("does not exist")) {
      return NextResponse.json({ recipients: [] });
    }
    throw e;
  } finally {
    client.release();
  }
}

type PostBody = {
  siteCode?: string;
  code?: string;
  displayName?: string;
  position?: string | null;
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
  const displayName = (body.displayName ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!displayName) return NextResponse.json({ error: "displayName is required" }, { status: 400 });

  let code: string | undefined;
  if (body.code?.trim()) {
    try {
      code = normalizeRecipientCode(body.code);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "invalid code" },
        { status: 400 }
      );
    }
  } else {
    code = recipientCodeFromDisplayName(displayName);
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const recipient = await createIssueRecipientDef(client, siteId, {
      code,
      displayName,
      position: body.position,
      sortOrder: body.sortOrder,
    });
    return NextResponse.json({ recipient }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("wms_issue_recipient_defs") || msg.includes("does not exist")) {
      return NextResponse.json(
        { error: "таблица справочника не создана — выполните миграцию БД (patches/2026-05-26_issue_recipient_defs.sql)" },
        { status: 503 }
      );
    }
    throw e;
  } finally {
    client.release();
  }
}
