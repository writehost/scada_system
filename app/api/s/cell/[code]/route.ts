import { NextResponse } from "next/server"
import { getCellScanView, resolveDefaultSiteId } from "@/lib/wms/cell-scan-view"
import { tryGetPool } from "@/lib/wms/pool"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request, segmentData: { params: Promise<{ code: string }> }) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }

  const params = await segmentData.params
  const locationCode = decodeURIComponent(params.code ?? "")
  if (!locationCode.trim()) {
    return NextResponse.json({ error: "location code is required" }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const siteId = await resolveDefaultSiteId(client)
    if (siteId == null) {
      return NextResponse.json({ error: "site not found" }, { status: 404 })
    }
    const view = await getCellScanView(client, siteId, locationCode)
    if (!view) {
      return NextResponse.json({ error: "location not found" }, { status: 404 })
    }
    return NextResponse.json(view)
  } finally {
    client.release()
  }
}
