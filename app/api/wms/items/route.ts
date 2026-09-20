import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { listItems } from "@/lib/wms/catalog";
import { ensureFinishedGoodsMatchingQuery } from "@/lib/wms/fg-product-from-label";
import { ensureFinishedGoodsFromPlan, mergePlacedIntoItemList } from "@/lib/wms/fg-plan-placed";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import { requireWmsSession } from "@/lib/wms/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

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

  const conn = await tryConnect(pool);
  if (!conn.ok) {
    return NextResponse.json(
      { error: conn.message, code: conn.code },
      { status: conn.status }
    );
  }

  const client = conn.client;
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const productGroupNames = url.searchParams
      .getAll("productGroup")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const activeParam = url.searchParams.get("isActive");
    const isActive =
      activeParam === "1" || activeParam === "true"
        ? true
        : activeParam === "0" || activeParam === "false"
          ? false
          : null;
    const role = (url.searchParams.get("role") ?? "").trim().toLowerCase()
    const query = url.searchParams.get("query") ?? url.searchParams.get("q") ?? ""
    const wantFg = role === "fg" || role === "finished_goods" || url.searchParams.get("excludeLabels") === "1"
    if (wantFg && query.trim().length >= 3) {
      try {
        await ensureFinishedGoodsMatchingQuery(client, siteId, query)
      } catch (e) {
        console.error("ensureFinishedGoodsMatchingQuery", e)
      }
    }
    if (wantFg) {
      try {
        await ensureFinishedGoodsFromPlan(client, siteId)
      } catch (e) {
        console.error("ensureFinishedGoodsFromPlan", e)
      }
    }
    const offset = Number(url.searchParams.get("offset") ?? "0")
    const data = await listItems(client, siteId, {
      query,
      materialType: url.searchParams.get("materialType") ?? "",
      itemGroupCode: url.searchParams.get("groupCode") ?? "",
      itemClassCode: url.searchParams.get("classCode") ?? "",
      itemTypeCode:
        wantFg
          ? url.searchParams.get("itemTypeCode") || "finished_goods,goods"
          : url.searchParams.get("itemTypeCode") ?? "",
      excludeLabels: wantFg,
      isActive,
      cursor: url.searchParams.get("cursor"),
      limit: Number(url.searchParams.get("limit") ?? "50"),
      offset,
      bareProductGroup: url.searchParams.get("bareProductGroup") === "1",
      productGroupNames,
    });
    if (wantFg) {
      const firstPage = !url.searchParams.get("cursor") && !(offset > 0)
      data.items = await mergePlacedIntoItemList(client, siteId, data.items as Record<string, unknown>[], {
        query,
        injectMissing: firstPage,
      })
    }
    return NextResponse.json(data);
  } catch (e) {
    const err = e as { code?: string };
    if (err?.code === "42P01" || err?.code === "42703") {
      return NextResponse.json(
        {
          error:
            "Схема номенклатуры устарела. Установите обновление WMS или выполните патч 2026-06-11_wms_items_nomenclature_columns.sql",
          code: "db_schema_outdated",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e), code: "db_query_failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
