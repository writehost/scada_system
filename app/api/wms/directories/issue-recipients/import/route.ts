import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { createIssueRecipientDef } from "@/lib/wms/issue-recipient-directory";
import { loadIssueRecipientsFromFile } from "@/lib/wms/issue-recipients-fallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PostBody = { siteCode?: string };

/** Импорт ФИО из legacy-файла wms-users.json в справочник. */
export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: PostBody = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const fromFile = await loadIssueRecipientsFromFile();
  if (fromFile.length === 0) {
    return NextResponse.json({ imported: 0, message: "Файл wms-users.json не найден или пуст" });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    let imported = 0;
    for (const row of fromFile) {
      await createIssueRecipientDef(client, siteId, {
        code: /^[A-Z0-9_]{1,64}$/.test(String(row.id).toUpperCase())
          ? String(row.id).toUpperCase()
          : undefined,
        displayName: row.displayName,
        position: row.subtitle,
      });
      imported += 1;
    }
    return NextResponse.json({ imported });
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
