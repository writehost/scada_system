import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { getItemOverview, getItemResources, replaceItemResources } from "@/lib/wms/catalog";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireWmsSession } from "@/lib/wms/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseComponents(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new WmsHttpError(400, "invalid json", "invalid_json");
  }
  const b = body as Record<string, unknown>;
  const rows = Array.isArray(b.components) ? b.components : [];
  return rows.map((row, idx) => {
    if (!row || typeof row !== "object") {
      throw new WmsHttpError(400, `component ${idx + 1}: invalid row`, "invalid_component");
    }
    const r = row as Record<string, unknown>;
    const itemCode = typeof r.itemCode === "string" ? r.itemCode : "";
    const uomCode = typeof r.uomCode === "string" ? r.uomCode : "pcs";
    const componentRoleCode =
      typeof r.componentRoleCode === "string" ? r.componentRoleCode : "material";
    const qtyPer =
      typeof r.qtyPer === "number"
        ? r.qtyPer
        : typeof r.qtyPer === "string"
          ? Number(r.qtyPer.replace(",", "."))
          : Number.NaN;
    return { itemCode, qtyPer, uomCode, componentRoleCode };
  });
}

/** Static route — dynamic `[itemCode]` routes in production Next.js reject POST reliably. */
export async function POST(req: Request) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode =
    typeof (body as { siteCode?: string })?.siteCode === "string"
      ? (body as { siteCode: string }).siteCode.trim()
      : "";
  const itemCode = decodeURIComponent(
    typeof (body as { itemCode?: string })?.itemCode === "string"
      ? (body as { itemCode: string }).itemCode
      : ""
  ).trim();

  if (!siteCode || !itemCode) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const components = parseComponents(body);
    const result = await replaceItemResources(client, siteId, itemCode, components);
    if (!result.updated) return NextResponse.json({ error: "item not found" }, { status: 404 });

    const overview = await getItemOverview(client, siteId, itemCode);
    if (!overview) return NextResponse.json({ error: "item not found" }, { status: 404 });
    const resources = await getItemResources(client, siteId, itemCode);
    return NextResponse.json({ ...overview, resources: resources?.resources ?? [] });
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  } finally {
    client.release();
  }
}
