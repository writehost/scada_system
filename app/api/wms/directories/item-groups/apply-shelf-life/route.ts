import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import {
  applyGroupShelfLifeToItems,
  ensureItemGroupsShelfLifeColumn,
  getItemGroupDefaultShelfLifeDays,
} from "@/lib/wms/stickers-group-shelf-life";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  siteCode?: string;
  groupCode?: string;
  shelfLifeDays?: number;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = String(body.siteCode ?? "").trim();
  const groupCode = String(body.groupCode ?? "").trim();
  if (!siteCode || !groupCode) {
    return NextResponse.json({ error: "siteCode and groupCode are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    await ensureItemGroupsShelfLifeColumn(client);
    const fromGroup = await getItemGroupDefaultShelfLifeDays(client, siteId, groupCode);
    const days = Number.isFinite(Number(body.shelfLifeDays))
      ? Math.max(1, Math.trunc(Number(body.shelfLifeDays)))
      : fromGroup;
    if (!days) {
      return NextResponse.json(
        { error: "Укажите shelfLifeDays или задайте defaultShelfLifeDays в группе" },
        { status: 400 }
      );
    }

    const updated = await applyGroupShelfLifeToItems(client, siteId, groupCode, days);
    return NextResponse.json({ ok: true, groupCode, shelfLifeDays: days, updatedItems: updated });
  } catch (e) {
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e), code: "db_query_failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
