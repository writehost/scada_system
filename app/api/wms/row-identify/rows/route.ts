import { NextResponse } from "next/server"
import { authorizeRowIdentify } from "@/lib/wms/row-identify-route"
import { listPlanRows } from "@/lib/wms/row-identify-rows"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await authorizeRowIdentify(req, url.searchParams.get("siteCode"))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rows = await listPlanRows(url.searchParams.get("query") ?? url.searchParams.get("q") ?? "")
  return NextResponse.json({ total: rows.length, rows })
}
