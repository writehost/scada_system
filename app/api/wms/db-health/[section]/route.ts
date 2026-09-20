import { NextResponse } from "next/server"
import { requireWmsSession } from "@/lib/wms/require-session"
import { collectDbHealth } from "@/lib/wms/db-health"
import { historyPayload } from "@/lib/wms/db-health-history"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isAdmin(roleCodes?: string[]) {
  return (roleCodes || []).some((r) => r === "admin")
}

const SECTIONS = new Set(["summary", "queries", "tables", "indexes", "recommendations", "history", "growth"])
const TTL_MS = 30_000

type Bundle = Awaited<ReturnType<typeof collectDbHealth>>

let cached: { at: number; value: Bundle } | null = null
let inFlight: Promise<Bundle> | null = null

async function loadHealth(): Promise<Bundle> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value
  if (inFlight) return inFlight
  inFlight = (async () => {
    const pool = tryGetPool()
    if (!pool) {
      const err = new Error("database not configured (set DATABASE_URL or PG_URL)") as Error & {
        status: number
        code: string
      }
      err.status = 503
      err.code = "db_unavailable"
      throw err
    }
    const conn = await tryConnect(pool)
    if (conn.ok !== true) {
      const failure = conn as { status: number; code: string; message: string }
      const err = new Error(failure.message) as Error & { status: number; code: string }
      err.status = failure.status
      err.code = failure.code
      throw err
    }
    const client = conn.client
    try {
      const value = await collectDbHealth(client)
      cached = { at: Date.now(), value }
      return value
    } finally {
      client.release()
    }
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

export async function GET(req: Request, ctx: { params: Promise<{ section: string }> }) {
  const auth = await requireWmsSession(req)
  if ("error" in auth) return auth.error
  if (!isAdmin(auth.session.roleCodes)) {
    return NextResponse.json({ error: "Только администратор WMS", code: "forbidden" }, { status: 403 })
  }

  const { section } = await ctx.params
  if (!SECTIONS.has(section)) {
    return NextResponse.json({ error: "unknown section" }, { status: 404 })
  }

  try {
    const url = new URL(req.url)
    const from = url.searchParams.get("from") || undefined
    const to = url.searchParams.get("to") || undefined
    if (section === "history" || section === "growth") {
      try {
        const data = await loadHealth()
        return NextResponse.json(historyPayload(data.summary.databaseName, from, to))
      } catch {
        return NextResponse.json(historyPayload(undefined, from, to))
      }
    }
    const data = await loadHealth()
    if (section === "summary") return NextResponse.json(data.summary)
    if (section === "queries") return NextResponse.json({ queries: data.queries })
    if (section === "tables") return NextResponse.json({ tables: data.tables })
    if (section === "indexes") return NextResponse.json({ indexes: data.indexes })
    return NextResponse.json({ recommendations: data.recommendations, readOnly: true })
  } catch (e) {
    const err = e as { message?: string; status?: number; code?: string }
    return NextResponse.json(
      { error: err.message || "db health collect failed", code: err.code || "db_health_failed" },
      { status: err.status || 500 }
    )
  }
}
