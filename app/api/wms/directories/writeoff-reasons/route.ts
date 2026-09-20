import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsErrorResponse } from "@/lib/wms/errors";
import {
  createWriteoffReasonDef,
  listWriteoffReasonDefs,
  normalizeReasonCode,
  reasonCodeFromDisplayName,
} from "@/lib/wms/writeoff-reasons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }
  const siteCode = new URL(req.url).searchParams.get("siteCode") ?? "";
  const activeOnly = new URL(req.url).searchParams.get("activeOnly") === "1";
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const reasons = await listWriteoffReasonDefs(client, siteId, { activeOnly });
    return NextResponse.json({ reasons });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}

type PostBody = {
  siteCode?: string;
  code?: string;
  displayName?: string;
  sortOrder?: number;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
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
      code = normalizeReasonCode(body.code);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "invalid code" },
        { status: 400 }
      );
    }
  } else {
    code = reasonCodeFromDisplayName(displayName);
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const reason = await createWriteoffReasonDef(client, siteId, {
      code,
      displayName,
      sortOrder: body.sortOrder,
    });
    return NextResponse.json({ reason }, { status: 201 });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
