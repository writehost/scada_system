import { NextResponse } from "next/server"
import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { getOneCSettings, normalizeODataRoot, oneCRequest } from "@/lib/wms/one-c-erp"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isAdmin(roleCodes?: string[]) {
  return (roleCodes || []).some((r) => r === "admin")
}

export async function POST(req: Request) {
  const token = await readAuthTokenFromRequest(req)
  const session = token ? await verifySessionToken(token) : null
  if (!session || !isAdmin(session.roleCodes)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    siteCode?: string
    baseUrl?: string
    login?: string
    password?: string
    viaFactory?: boolean
  }
  const saved = await getOneCSettings(body.siteCode?.trim() || "DEFAULT")
  const settings = {
    enabled: true,
    baseUrl: body.baseUrl?.trim() || saved.baseUrl,
    login: body.login?.trim() || saved.login,
    password: body.password || saved.password,
    viaFactory: body.viaFactory !== undefined ? body.viaFactory !== false : saved.viaFactory,
  }
  if (!settings.baseUrl) return NextResponse.json({ error: "Укажите адрес 1С ERP" }, { status: 400 })

  const started = Date.now()
  try {
    const root = normalizeODataRoot(settings.baseUrl)
    const url = `${root}/Catalog_Номенклатура?$format=json&$inlinecount=allpages&$top=1&$skip=0`
    const payload = (await oneCRequest(url, settings, 25000)) as { "odata.count"?: string; value?: unknown[] }
    const count = Number(payload["odata.count"] ?? 0)
    return NextResponse.json({
      ok: true,
      status: 200,
      elapsedMs: Date.now() - started,
      total: Number.isFinite(count) ? count : (payload.value?.length ?? 0),
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : "connection failed",
      elapsedMs: Date.now() - started,
    })
  }
}
