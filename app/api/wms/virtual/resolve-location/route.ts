import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const siteCode = searchParams.get("siteCode")?.trim() ?? ""
  const locationCode = searchParams.get("locationCode")?.trim() ?? ""
  if (!siteCode || !locationCode) {
    return NextResponse.json(
      { error: "siteCode and locationCode are required", layoutId: null, nodeId: null },
      { status: 400 }
    )
  }

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode", layoutId: null, nodeId: null }, { status: 404 })
    }

    const r = await client.query<{ layout_id: string; node_id: string }>(
      `SELECT l.layout_id::text, n.node_id::text
       FROM wms_locations loc
       JOIN wms_virtual_links lnk ON lnk.location_id = loc.location_id
       JOIN wms_virtual_nodes n ON n.node_id = lnk.node_id
       JOIN wms_virtual_layouts l ON l.layout_id = n.layout_id
       WHERE loc.site_id = $1 AND lower(btrim(loc.location_code)) = lower(btrim($2::text))
       LIMIT 1`,
      [siteId, locationCode]
    )
    const row = r.rows[0]
    if (!row) return NextResponse.json({ layoutId: null, nodeId: null })
    return NextResponse.json({ layoutId: row.layout_id, nodeId: row.node_id })
  } finally {
    client.release()
  }
}
