import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  createProductionLineDef,
  listProductionLineDefs,
  normalizeProductionLineCode,
  lineCodeFromDisplayName,
} from "@/lib/wms/production-line-directory";

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
  const activeOnly = url.searchParams.get("activeOnly") === "1";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const lines = await listProductionLineDefs(client, siteId, { activeOnly });
    return NextResponse.json({ lines });
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
      code = normalizeProductionLineCode(body.code);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "invalid code" },
        { status: 400 }
      );
    }
  } else {
    code = lineCodeFromDisplayName(displayName);
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const line = await createProductionLineDef(client, siteId, {
      code,
      displayName,
      sortOrder: body.sortOrder,
    });
    return NextResponse.json({ line }, { status: 201 });
  } finally {
    client.release();
  }
}
