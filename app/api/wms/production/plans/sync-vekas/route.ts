import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { WmsHttpError, wmsErrorResponse } from "@/lib/wms/errors"
import { requireLineApi } from "@/lib/wms/line-auth"
import { ensureVekasApsSchema, listVekasApsWatches, syncVekasApsBatches } from "@/lib/wms/vekas-aps-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 800

function siteCodeOf(req: Request, body?: { siteCode?: unknown }): string {
  if (typeof body?.siteCode === "string" && body.siteCode.trim()) return body.siteCode.trim()
  return new URL(req.url).searchParams.get("siteCode")?.trim() || ""
}

/**
 * Календарь запрашивает наблюдения из нескольких мест сразу. Одинаковые чтения
 * склеиваем: до базы на заводе далеко, а список меняется не чаще синхронизации.
 */
type WatchesResponse = { watching: number; watches: unknown[] }
const WATCHES_TTL_MS = 5_000
const watchesCache = new Map<string, { at: number; value: WatchesResponse }>()
const watchesInFlight = new Map<string, Promise<WatchesResponse>>()

export async function GET(req: Request) {
  const denied = await requireLineApi(req)
  if (denied) return denied
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const siteCode = siteCodeOf(req)
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  const state = (new URL(req.url).searchParams.get("state") || "all") as
    | "watching"
    | "completed"
    | "skipped"
    | "all"

  const cacheKey = `${siteCode}:${state}`
  const cached = watchesCache.get(cacheKey)
  if (cached && Date.now() - cached.at < WATCHES_TTL_MS) {
    return NextResponse.json(cached.value)
  }

  const running = watchesInFlight.get(cacheKey)
  if (running) {
    try {
      return NextResponse.json(await running)
    } catch (error) {
      return wmsErrorResponse(error)
    }
  }

  const task = (async (): Promise<WatchesResponse> => {
    const client = await pool.connect()
    try {
      const siteId = await getSiteId(client, siteCode)
      if (siteId == null) throw new WmsHttpError(404, "unknown siteCode")
      await ensureVekasApsSchema(client)
      const watches = await listVekasApsWatches(client, siteId, { state })
      const value: WatchesResponse = {
        watching: watches.filter((w) => w.watchState === "watching").length,
        watches,
      }
      watchesCache.set(cacheKey, { at: Date.now(), value })
      return value
    } finally {
      client.release()
    }
  })()

  watchesInFlight.set(cacheKey, task)
  try {
    return NextResponse.json(await task)
  } catch (error) {
    return wmsErrorResponse(error)
  } finally {
    watchesInFlight.delete(cacheKey)
  }
}

export async function POST(req: Request) {
  const denied = await requireLineApi(req)
  if (denied) return denied
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  let body: { siteCode?: unknown; historyDays?: unknown; importFgHistory?: unknown } = {}
  try {
    body = (await req.json()) as { siteCode?: unknown; historyDays?: unknown; importFgHistory?: unknown }
  } catch {
    body = {}
  }
  const siteCode = siteCodeOf(req, body)
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  const importFgHistory = body.importFgHistory === true || body.importFgHistory === "1"
  const historyDaysRaw = Number(body.historyDays)
  const explicitHistoryDays =
    Number.isFinite(historyDaysRaw) && historyDaysRaw > 0 ? Math.min(120, Math.round(historyDaysRaw)) : undefined

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const result = await syncVekasApsBatches(
      client,
      siteId,
      importFgHistory || explicitHistoryDays
        ? {
            historyDays: importFgHistory ? undefined : explicitHistoryDays,
            importFgHistory,
            fgHistoryDays: importFgHistory ? explicitHistoryDays ?? 90 : undefined,
            fgHistoryCap: importFgHistory ? 40 : undefined,
            fgBackfillCap: importFgHistory ? 40 : undefined,
          }
        : undefined
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return wmsErrorResponse(error)
  } finally {
    client.release()
  }
}
