import { NextResponse } from "next/server"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }

  const url = new URL(req.url)
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim()
  const query = (url.searchParams.get("query") ?? "").trim()
  const supplierCode = (url.searchParams.get("supplierCode") ?? "").trim()
  const supplierName = (url.searchParams.get("supplierName") ?? "").trim()

  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  }
  if (query.length < 2) {
    return NextResponse.json({ hits: [] })
  }

  const conn = await tryConnect(pool)
  if (!conn.ok) {
    return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  }

  const client = conn.client
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    }

    const r = await client.query<{
      itemCode: string
      itemName: string
      aliasName: string
      aliasSku: string | null
      supplierCode: string | null
      supplierName: string | null
    }>(
      `
      SELECT
        i.item_code AS "itemCode",
        i.name AS "itemName",
        a.alias_name AS "aliasName",
        a.alias_sku AS "aliasSku",
        a.supplier_code AS "supplierCode",
        a.supplier_name AS "supplierName"
      FROM wms_item_aliases a
      JOIN wms_items i ON i.item_id = a.item_id AND i.site_id = a.site_id
      WHERE a.site_id = $1
        AND a.is_active
        AND (
          a.alias_name ILIKE '%' || $2 || '%'
          OR COALESCE(a.alias_sku, '') ILIKE '%' || $2 || '%'
        )
        AND ($3::text = '' OR COALESCE(a.supplier_code, '') ILIKE '%' || $3 || '%'
          OR COALESCE(a.supplier_name, '') ILIKE '%' || $3 || '%')
        AND ($4::text = '' OR COALESCE(a.supplier_code, '') ILIKE '%' || $4 || '%'
          OR COALESCE(a.supplier_name, '') ILIKE '%' || $4 || '%')
      ORDER BY
        CASE WHEN lower(a.alias_name) = lower($2) THEN 0 ELSE 1 END,
        a.updated_at DESC
      LIMIT 20
      `,
      [siteId, query, supplierCode, supplierName]
    )

    return NextResponse.json({ hits: r.rows })
  } catch (e) {
    const err = e as { code?: string }
    if (err?.code === "42P01") {
      return NextResponse.json({ hits: [], tableMissing: true })
    }
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e) || "internal error" },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
