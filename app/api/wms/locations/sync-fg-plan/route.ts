import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { wmsErrorResponse } from "@/lib/wms/errors"
import { listPlanRows } from "@/lib/wms/row-identify-rows"
import { syncFgPlanLocations } from "@/lib/wms/fg-plan-locations"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function siteCodeOf(req: Request, body?: { siteCode?: unknown }): string {
  if (typeof body?.siteCode === "string" && body.siteCode.trim()) return body.siteCode.trim()
  return new URL(req.url).searchParams.get("siteCode")?.trim() || ""
}

export async function GET(req: Request) {
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const siteCode = siteCodeOf(req)
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const catalog = await listPlanRows()
    const existing = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
       FROM wms_locations
       WHERE site_id = $1
         AND COALESCE(location_attrs_json->>'planRowId', '') <> ''`,
      [siteId]
    )
    return NextResponse.json({
      catalogRows: catalog.length,
      existingPlanLocations: Number(existing.rows[0]?.n ?? 0),
      zones: [...new Set(catalog.map((row) => row.zone.trim().toUpperCase()).filter(Boolean))],
    })
  } catch (error) {
    return wmsErrorResponse(error)
  } finally {
    client.release()
  }
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })

  let body: { siteCode?: unknown } = {}
  try {
    body = (await req.json()) as { siteCode?: unknown }
  } catch {
    body = {}
  }
  const siteCode = siteCodeOf(req, body)
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const result = await syncFgPlanLocations(client, siteId)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return wmsErrorResponse(error)
  } finally {
    client.release()
  }
}
