import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { listReceivingStockPostsForSite } from "@/lib/wms/receiving-finalize";

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
    const posts = await listReceivingStockPostsForSite(client, siteId, { limit: 2000 });
    const byDoc = new Map<string, (typeof posts)[0]>();
    for (const p of posts) {
      const prev = byDoc.get(p.documentId);
      if (!prev || Date.parse(p.postedAtIso || "") > Date.parse(prev.postedAtIso || "")) {
        byDoc.set(p.documentId, p);
      }
    }
    return NextResponse.json({
      posts: Array.from(byDoc.values()),
      generatedAt: new Date().toISOString(),
    });
  } finally {
    client.release();
  }
}
