import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import {
  refreshReceivingTorg1Forms,
  type Torg1RefreshMode,
} from "@/lib/wms/torg1-refresh"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseMode(v: unknown): Torg1RefreshMode {
  return v === "full_reset" ? "full_reset" : "template"
}

/** POST — пересобрать ТОРГ-1 у документов приёмки по текущему шаблону. */
export async function POST(req: Request) {
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })

  let body: {
    siteCode?: string
    mode?: Torg1RefreshMode
    documentIds?: string[]
    sessionIds?: string[]
    sessions?: Array<{ sessionId: string; hints?: Record<string, string | null> }>
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const siteCode = String(body.siteCode ?? "").trim()
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const mode = parseMode(body.mode)
  const documentIds = Array.isArray(body.documentIds)
    ? body.documentIds.map((id) => String(id).trim()).filter(Boolean)
    : undefined
  const sessionIds = Array.isArray(body.sessionIds)
    ? body.sessionIds.map((id) => String(id).trim()).filter(Boolean)
    : undefined
  const sessions = Array.isArray(body.sessions)
    ? body.sessions
        .map((s) => ({
          sessionId: String(s.sessionId ?? "").trim(),
          hints: s.hints,
        }))
        .filter((s) => s.sessionId)
    : undefined

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })

    const result = await refreshReceivingTorg1Forms(client, siteId, mode, {
      documentIds: documentIds?.length ? documentIds : undefined,
      sessionIds: sessions?.length ? undefined : sessionIds?.length ? sessionIds : undefined,
      sessions: sessions?.length ? sessions : undefined,
    })

    return NextResponse.json({
      ok: true,
      mode,
      ...result,
      totalUpdated: result.documentsUpdated + result.sessionsUpdated,
    })
  } finally {
    client.release()
  }
}
