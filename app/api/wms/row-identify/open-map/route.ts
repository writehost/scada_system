import { NextResponse } from "next/server"
import { planPageUrl, verifyMapToken } from "@/lib/wms/row-identify-token"
import { requestOrigin } from "@/lib/wms/row-identify-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get("token")?.trim() || url.searchParams.get("mapToken")?.trim() || ""
  const payload = token ? verifyMapToken(token) : null
  if (!payload) {
    return NextResponse.json({ error: "invalid or expired map token" }, { status: 401 })
  }
  const rowId = url.searchParams.get("row")?.trim() || payload.rowId || ""
  return NextResponse.redirect(planPageUrl(requestOrigin(req), token, rowId || null), 302)
}
