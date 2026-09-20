import { NextResponse } from "next/server"
import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { WmsHttpError } from "@/lib/wms/errors"
import { describeRequestOrigin } from "@/lib/wms/label-order-author"
import { resetDeviceAuthModeCache } from "@/lib/wms/device-auth"
import { requireWmsActor } from "@/lib/wms/require-actor"
import {
  getDeviceAuthSettings,
  issueDeviceToken,
  issueEnrollToken,
  listDeviceTokens,
  listEnrollTokens,
  loadDeviceTokenSummary,
  revokeDeviceTokens,
  revokeEnrollToken,
  saveDeviceAuthSettings,
  type DeviceTokenActor,
} from "@/lib/wms/device-tokens"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Выпуск и отзыв кодов подключения — только для человека с сессией WMS. */
async function requireActor(req: Request): Promise<DeviceTokenActor> {
  const token = await readAuthTokenFromRequest(req).catch(() => null)
  const session = token ? await verifySessionToken(token) : null
  if (!session) {
    throw new WmsHttpError(401, "Нужен вход в WMS", "auth_required")
  }
  return {
    login: session.login ?? "",
    fio: session.fio ?? "",
    origin: describeRequestOrigin(req),
  }
}

async function withSite<T>(
  siteCode: string,
  fn: (client: import("pg").PoolClient, siteId: number) => Promise<T>
): Promise<T> {
  const pool = tryGetPool()
  if (!pool) throw new WmsHttpError(503, "database not configured", "no_database")
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode || "DEFAULT")
    if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "unknown_site")
    return await fn(client, siteId)
  } finally {
    client.release()
  }
}

function fail(error: unknown) {
  if (error instanceof WmsHttpError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  console.error(error)
  const message = error instanceof Error ? error.message : String(error)
  return NextResponse.json({ error: message }, { status: 500 })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode")?.trim() || "DEFAULT"
  const includeClosed = url.searchParams.get("history") === "1"
  try {
    await requireActor(req)
    const data = await withSite(siteCode, async (client, siteId) => {
      const [settings, tokens, deviceTokens, summary] = await Promise.all([
        getDeviceAuthSettings(client, siteId),
        listEnrollTokens(client, siteId, { includeClosed, limit: includeClosed ? 100 : 20 }),
        listDeviceTokens(client, siteId),
        loadDeviceTokenSummary(client, siteId),
      ])
      return {
        settings,
        tokens,
        deviceTokens,
        devicesWithToken: Object.fromEntries(summary),
      }
    })
    return NextResponse.json({ ok: true, ...data })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  let body: {
    action?: string
    siteCode?: string
    deviceName?: string
    platform?: string
    ttlMinutes?: number
    maxUses?: number
    note?: string
    tokenId?: string
    deviceUid?: string
    settings?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const siteCode = body.siteCode?.trim() || "DEFAULT"

  try {
    const actor = await requireActor(req)

    if (body.action === "issue") {
      const result = await withSite(siteCode, (client, siteId) =>
        issueEnrollToken(client, siteId, {
          deviceName: body.deviceName,
          platform: body.platform,
          ttlMinutes: body.ttlMinutes,
          maxUses: body.maxUses,
          note: body.note,
          actor,
        })
      )
      return NextResponse.json({ ok: true, ...result })
    }

    if (body.action === "revoke") {
      const tokenId = body.tokenId?.trim()
      if (!tokenId) return NextResponse.json({ error: "tokenId required" }, { status: 400 })
      await withSite(siteCode, (client, siteId) => revokeEnrollToken(client, siteId, { tokenId, actor }))
      return NextResponse.json({ ok: true })
    }

    if (body.action === "revoke-device") {
      const deviceUid = body.deviceUid?.trim()
      if (!deviceUid) return NextResponse.json({ error: "deviceUid required" }, { status: 400 })
      const revoked = await withSite(siteCode, (client, siteId) =>
        revokeDeviceTokens(client, siteId, { deviceUid, actor })
      )
      return NextResponse.json({ ok: true, revoked })
    }

    // Ручная выдача токена без кода: когда терминал настраивает администратор сам.
    if (body.action === "issue-device-token") {
      const deviceUid = body.deviceUid?.trim()
      if (!deviceUid) return NextResponse.json({ error: "deviceUid required" }, { status: 400 })
      const deviceToken = await withSite(siteCode, (client, siteId) =>
        issueDeviceToken(client, siteId, { deviceUid, actor, via: "admin" })
      )
      return NextResponse.json({ ok: true, deviceUid, deviceToken })
    }

    if (body.action === "save-settings") {
      const settings = await withSite(siteCode, (client, siteId) =>
        saveDeviceAuthSettings(client, siteId, body.settings ?? body, actor)
      )
      resetDeviceAuthModeCache()
      return NextResponse.json({ ok: true, settings })
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 })
  } catch (error) {
    return fail(error)
  }
}
