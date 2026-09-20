import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { getScadaIdSettings, publicScadaIdStatus } from "@/lib/wms/scada-id"
import { canonicalSiteCode } from "@/lib/wms/site-code"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const siteCode = canonicalSiteCode(new URL(req.url).searchParams.get("siteCode"))
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({
      enabled: false,
      configured: false,
      issuer: "",
      loginAvailable: false,
    })
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      return NextResponse.json({
        enabled: false,
        configured: false,
        issuer: "",
        loginAvailable: false,
      })
    }
    const settings = await getScadaIdSettings(client, siteId)
    return NextResponse.json(publicScadaIdStatus(settings))
  } finally {
    client.release()
  }
}
