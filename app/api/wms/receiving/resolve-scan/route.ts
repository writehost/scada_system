import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { resolveReceivingScan } from "@/lib/wms/receiving-crpt";
import { getUpstreamCrptBearerToken } from "@/lib/wms/crpt-auth";
import { WmsHttpError } from "@/lib/wms/errors";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import { requireWmsActor } from "@/lib/wms/require-actor";
import { evaluateReceivingScanPolicy } from "@/lib/receiving-scan-policy";
import { loadReceivingSiteRules } from "@/lib/wms/receiving-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: {
    siteCode?: string;
    code?: string;
    receivingCategory?: string;
    productGroup?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = String(body.siteCode ?? "").trim();
  const code = String(body.code ?? "").trim();
  if (!siteCode || !code) {
    return NextResponse.json({ error: "siteCode and code are required" }, { status: 400 });
  }

  const scanCtx = {
    receivingCategory: String(body.receivingCategory ?? "").trim() || null,
    productGroup: String(body.productGroup ?? "").trim() || null,
  };

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const token = await getUpstreamCrptBearerToken();
    await client.query("BEGIN");
    const result = await resolveReceivingScan(client, siteId, code, token, scanCtx);
    const rules = await loadReceivingSiteRules(client, siteId);
    const productGroup =
      scanCtx.productGroup ||
      scanCtx.receivingCategory ||
      (result.primaryItem as { productGroup?: string | null } | null)?.productGroup ||
      null;
    const scanGate = evaluateReceivingScanPolicy(
      {
        crptStatus: result.crptStatus,
        expiryState: result.expiry?.state ?? null,
        productGroup,
      },
      rules
    );
    await client.query("COMMIT");

    return NextResponse.json({ ...result, scanGate, receivingRules: rules });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof WmsHttpError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error("[POST /api/wms/receiving/resolve-scan]", error);
    return NextResponse.json(
      {
        error: wmsDbErrorToUserMessage(error) || "Receiving resolve failed",
        code: "receiving_resolve_failed",
      },
      { status: 502 }
    );
  } finally {
    client.release();
  }
}
