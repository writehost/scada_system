import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { createItemAlias } from "@/lib/wms/item-aliases";
import { WmsHttpError, wmsErrorResponse } from "@/lib/wms/errors";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StandardizationAliasBody = {
  siteCode?: string;
  itemCode?: string;
  supplierCode?: string | null;
  supplierName?: string | null;
  supplierArticle?: string | null;
  supplierItemName?: string | null;
  gtin?: string | null;
  sourceCode?: string | null;
  codeSource?: "crpt" | "barcode" | "none" | "manual" | string;
  linkBarcode?: boolean;
  note?: string | null;
};

function trimOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  let body: StandardizationAliasBody;
  try {
    body = (await req.json()) as StandardizationAliasBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const itemCode = (body.itemCode ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!itemCode) return NextResponse.json({ error: "itemCode is required" }, { status: 400 });

  const supplierCode = trimOrNull(body.supplierCode);
  const supplierName = trimOrNull(body.supplierName);
  const supplierArticle = trimOrNull(body.supplierArticle);
  const supplierItemName = trimOrNull(body.supplierItemName);
  const gtin = trimOrNull(body.gtin);
  const sourceCode = trimOrNull(body.sourceCode);
  const aliasName = supplierItemName ?? supplierArticle ?? sourceCode;
  if (!aliasName) {
    return NextResponse.json(
      { error: "supplierItemName, supplierArticle or sourceCode is required" },
      { status: 400 }
    );
  }

  const codeSource = (body.codeSource ?? "manual").trim() || "manual";
  const source = [codeSource, trimOrNull(body.note)].filter(Boolean).join(": ");

  const conn = await tryConnect(pool);
  if (!conn.ok) {
    return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status });
  }

  const client = conn.client;
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const item = await client.query<{ itemId: string; itemName: string }>(
      `SELECT item_id::text AS "itemId", name AS "itemName"
       FROM wms_items
       WHERE site_id = $1 AND item_code = $2`,
      [siteId, itemCode]
    );
    const row = item.rows[0];
    if (!row) {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }

    const alias = await createItemAlias(client, siteId, {
      itemCode,
      supplierCode,
      supplierName,
      aliasName,
      aliasSku: supplierArticle,
      gtin,
      source,
    });

    if (body.linkBarcode === true && sourceCode) {
      await client.query(
        `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
         VALUES ($1::bigint, $2, 'supplier', FALSE, now())
         ON CONFLICT (barcode) DO UPDATE SET item_id = EXCLUDED.item_id`,
        [row.itemId, sourceCode]
      );
    }

    return NextResponse.json({
      ok: true,
      itemCode,
      itemName: row.itemName,
      canonicalProductId: row.itemId,
      supplierId: supplierCode ?? "",
      supplierItemAliasId: alias.aliasId,
      aliasId: alias.aliasId,
    });
  } catch (e) {
    if (e instanceof WmsHttpError) return wmsErrorResponse(e);
    const err = e as { code?: string };
    if (err?.code === "42P01") {
      return NextResponse.json(
        { error: "Таблица алиасов не создана — примените миграции WMS" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e) || "internal error" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
