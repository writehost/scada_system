import { NextResponse } from "next/server"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"

export async function withFgSite(
  req: Request,
  handler: (client: import("pg").PoolClient, siteId: number) => Promise<NextResponse>
) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }
  const url = new URL(req.url)
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim()
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
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
    return await handler(client, siteId)
  } catch (e) {
    const err = e as { code?: string }
    if (err?.code === "42P01" || err?.code === "42703") {
      return NextResponse.json(
        { error: "Схема БД устарела — установите обновление WMS", code: "db_schema_outdated" },
        { status: 503 }
      )
    }
    console.error(e)
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e) || "internal error" },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
