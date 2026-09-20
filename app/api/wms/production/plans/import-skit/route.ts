import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsErrorResponse } from "@/lib/wms/errors";
import {
  batchImportSkitProductionPlans,
  type SkitPlanImportInput,
} from "@/lib/wms/production-plan-directory";
import { mergeSkitLabelMappings } from "@/lib/wms/skit-product-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  siteCode?: string;
  rows?: SkitPlanImportInput[];
  itemMapping?: Record<string, string>;
  autoMatches?: Record<string, { itemCode: string; itemName: string; score: number } | null>;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (rows.length === 0) return NextResponse.json({ error: "rows is required" }, { status: 400 });

  const auto: Record<string, { itemCode: string; itemName: string; score: number } | null> = {};
  for (const [label, match] of Object.entries(body.autoMatches ?? {})) {
    auto[label] = match?.itemCode
      ? { itemCode: match.itemCode, itemName: match.itemName, score: match.score }
      : null;
  }
  const itemMapping = mergeSkitLabelMappings(auto, body.itemMapping ?? {});

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    await client.query("BEGIN");
    const results = await batchImportSkitProductionPlans(client, siteId, rows, itemMapping);
    await client.query("COMMIT");

    const summary = {
      total: results.length,
      created: results.filter((r) => r.status === "created").length,
      updated: results.filter((r) => r.status === "updated").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      errors: results.filter((r) => r.status === "error").length,
    };
    return NextResponse.json({ results, summary });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
