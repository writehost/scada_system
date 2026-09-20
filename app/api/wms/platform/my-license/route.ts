import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { loadSiteLicense, isLicenseValid, siteHasFeature, SAAS_FEATURES } from "@/lib/wms/saas-license"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const siteCode = (url.searchParams.get("siteCode") || process.env.WMS_SITE_CODE || "skeet").trim()
  const pool = tryGetPool(siteCode)
  if (!pool) return NextResponse.json({ error: "нет БД" }, { status: 503 })
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (!siteId) return NextResponse.json({ error: "сайт не найден" }, { status: 404 })
    const license = await loadSiteLicense(client, siteId)
    if (!license) return NextResponse.json({ error: "лицензия не найдена" }, { status: 404 })
    const features: Record<string, boolean> = {}
    for (const f of SAAS_FEATURES) features[f] = siteHasFeature(license, f)
    return NextResponse.json({
      siteCode: license.siteCode,
      name: license.name,
      planCode: license.planCode,
      licenseType: license.licenseType,
      valid: isLicenseValid(license),
      expiresAt: license.licenseExpiresAt,
      features,
    })
  } finally {
    client.release()
  }
}
