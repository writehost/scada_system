import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { resolveUserAuth } from "@/lib/auth/resolve-user-auth"
import type { WmsAuthSession } from "@/lib/auth/types"
import { isPhysicalDeviceUid, readDeviceTokenFromRequest } from "@/lib/wms/device-auth"
import { checkDeviceToken, getDeviceAuthSettings } from "@/lib/wms/device-tokens"
import { touchDeviceLastSeenQuiet } from "@/lib/wms/devices"
import { isLocalRequest } from "@/lib/wms/local-request"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"

export type WmsActor = {
  via: "session" | "api-token" | "device-token" | "registered-device" | "local"
  session: WmsAuthSession | null
  deviceUid: string | null
  userId: string | null
}

function unauthorized(message = "Нужен вход в WMS или токен терминала") {
  return NextResponse.json({ error: message, code: "auth_required" }, { status: 401 })
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function headerOrQuery(req: Request, header: string, query: string): string {
  const url = new URL(req.url)
  return (req.headers.get(header) || url.searchParams.get(query) || "").trim()
}

/** siteCode / deviceUid из query, заголовков или JSON-тела (через clone, тело маршрута не съедаем). */
async function hintsFromRequest(
  req: Request,
  input: { siteCode?: string; deviceUid?: string }
): Promise<{ siteCode: string; deviceUid: string }> {
  let siteCode = (input.siteCode || "").trim() || headerOrQuery(req, "x-site-code", "siteCode")
  let deviceUid = (input.deviceUid || "").trim() || headerOrQuery(req, "x-device-uid", "deviceUid")
  if (siteCode && deviceUid) return { siteCode, deviceUid }

  const contentType = req.headers.get("content-type") || ""
  if (!contentType.toLowerCase().includes("json")) {
    return { siteCode, deviceUid }
  }
  try {
    const body = (await req.clone().json()) as Record<string, unknown>
    if (body && typeof body === "object") {
      if (!siteCode && typeof body.siteCode === "string") siteCode = body.siteCode.trim()
      if (!deviceUid && typeof body.deviceUid === "string") deviceUid = body.deviceUid.trim()
    }
  } catch {
    /* тело ещё не JSON или пустое — не ошибка авторизации */
  }
  return { siteCode, deviceUid }
}

/**
 * Кто может менять склад и задания.
 *
 * - сессия человека (веб);
 * - действующий токен ТСД;
 * - в режиме soft/off — только уже зарегистрированный deviceUid (старые терминалы без токена);
 * - allowLocal — cron с loopback.
 *
 * Анонимный POST без сессии, токена и известного терминала — 401.
 */
export async function requireWmsActor(
  req: Request,
  input: {
    siteCode?: string
    deviceUid?: string
    allowLocal?: boolean
    allowRegisteredDevice?: boolean
  } = {}
): Promise<{ actor: WmsActor } | { error: NextResponse }> {
  if (input.allowLocal && isLocalRequest(req)) {
    return { actor: { via: "local", session: null, deviceUid: null, userId: null } }
  }

  const userAuth = await resolveUserAuth(req).catch(() => null)
  if (userAuth) {
    const hints = await hintsFromRequest(req, input)
    return {
      actor: {
        via: userAuth.via,
        session: userAuth.session,
        deviceUid: hints.deviceUid || null,
        userId: userAuth.session.userId?.trim() || null,
      },
    }
  }

  const pool = tryGetPool()
  if (!pool) return { error: unauthorized() }

  const deviceToken = readDeviceTokenFromRequest(req)
  const hints = await hintsFromRequest(req, input)
  const siteCode = hints.siteCode
  const deviceUidHint = hints.deviceUid
  const client = await pool.connect()
  try {
    if (deviceToken) {
      let siteId = siteCode ? await getSiteId(client, siteCode) : null
      if (siteId == null) {
        const hashed = sha256(deviceToken)
        const row = await client.query<{ site_id: number; device_uid: string; revoked_at: string | null }>(
          `SELECT site_id, device_uid, revoked_at::text AS revoked_at
           FROM wms_device_tokens
           WHERE token_hash = $1
           LIMIT 1`,
          [hashed]
        )
        const hit = row.rows[0]
        if (!hit || hit.revoked_at) {
          return {
            error: NextResponse.json(
              { error: "Токен терминала недействителен", code: "device_token_invalid" },
              { status: 401 }
            ),
          }
        }
        siteId = hit.site_id
      }
      const check = await checkDeviceToken(client, {
        token: deviceToken,
        siteId,
        deviceUid: deviceUidHint || undefined,
      })
      if (!check.ok) {
        return {
          error: NextResponse.json(
            { error: "Токен терминала недействителен", code: "device_token_invalid" },
            { status: 401 }
          ),
        }
      }
      await touchDeviceLastSeenQuiet(client, siteId, check.deviceUid)
      return {
        actor: {
          via: "device-token",
          session: null,
          deviceUid: check.deviceUid,
          userId: null,
        },
      }
    }

    if (input.allowRegisteredDevice && isPhysicalDeviceUid(deviceUidHint)) {
      let siteId = siteCode ? await getSiteId(client, siteCode) : null
      if (siteId == null) {
        const byUid = await client.query<{ site_id: number }>(
          `SELECT site_id FROM wms_devices WHERE device_uid = $1 LIMIT 1`,
          [deviceUidHint]
        )
        siteId = byUid.rows[0]?.site_id ?? null
      }
      if (siteId == null) {
        return { error: NextResponse.json({ error: "unknown siteCode" }, { status: 404 }) }
      }
      const settings = await getDeviceAuthSettings(client, siteId)
      if (settings.mode === "strict") {
        return {
          error: NextResponse.json(
            { error: "Терминал не подключён: нужен код подключения из раздела «Терминалы»", code: "device_token_required" },
            { status: 401 }
          ),
        }
      }
      const known = await client.query(
        `SELECT 1 FROM wms_devices WHERE site_id = $1 AND device_uid = $2 LIMIT 1`,
        [siteId, deviceUidHint]
      )
      if (known.rows.length > 0) {
        await touchDeviceLastSeenQuiet(client, siteId, deviceUidHint)
        return {
          actor: {
            via: "registered-device",
            session: null,
            deviceUid: deviceUidHint,
            userId: null,
          },
        }
      }
      return {
        error: NextResponse.json(
          { error: "Терминал не зарегистрирован", code: "device_unknown" },
          { status: 401 }
        ),
      }
    }
  } finally {
    client.release()
  }

  return { error: unauthorized() }
}
