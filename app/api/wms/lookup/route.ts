import { NextResponse } from "next/server"
import { getSiteId } from "@/lib/wms/resolve"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { runLookup } from "@/lib/wms/query"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handle(req: Request, siteCode: string, query: string) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true })
  if ("error" in actorGate) return actorGate.error

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    )
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
    const body = await runLookup(client, siteId, query)
    return NextResponse.json(body)
  } finally {
    client.release()
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode") ?? ""
  const query = url.searchParams.get("query") ?? url.searchParams.get("q") ?? ""
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  }
  return handle(req, siteCode, query)
}

export async function POST(req: Request) {
  let body: { siteCode?: string; query?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const siteCode = typeof body.siteCode === "string" ? body.siteCode : ""
  const query = typeof body.query === "string" ? body.query : ""
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  }
  return handle(req, siteCode, query)
}
