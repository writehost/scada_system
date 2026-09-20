import { NextResponse } from "next/server"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"

export async function withFleetSite(
  req: Request,
  handler: (
    client: import("pg").PoolClient,
    siteId: number,
    body: Record<string, unknown>
  ) => Promise<NextResponse>
) {
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })

  let body: Record<string, unknown> = {}
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      const parsed = await req.json()
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>
    } catch {
      if (req.method !== "DELETE") {
        return NextResponse.json({ error: "invalid json" }, { status: 400 })
      }
    }
  }

  const url = new URL(req.url)
  const siteCode = String(url.searchParams.get("siteCode") || body.siteCode || "").trim()
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })

  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    return await handler(conn.client, siteId, body)
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal error"
    const status = /не найден|укажите|нет точек|не поедет|тег пути/i.test(message) ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  } finally {
    conn.client.release()
  }
}
