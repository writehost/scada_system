import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { registerWmsDevice } from "@/lib/wms/devices"
import { redeemEnrollCode } from "@/lib/wms/device-tokens"
import { WmsHttpError } from "@/lib/wms/errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Подключение ТСД по коду: код → постоянный токен устройства.
 * Маршрут публичный по определению — терминал ещё ничем не авторизован,
 * защита строится на том, что код короткоживущий, одноразовый и гасится атомарно.
 */

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? ""
  return forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || ""
}

function describeOrigin(req: Request): string {
  const ip = clientIp(req)
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 120)
  return [ip ? `IP ${ip}` : "", ua].filter(Boolean).join(" · ")
}

function randomDeviceUid(prefix: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let tail = ""
  for (let i = 0; i < 6; i += 1) {
    tail += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `${prefix}-${tail}`
}

export async function POST(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }

  let body: {
    code?: string
    deviceUid?: string
    deviceName?: string
    platform?: string
    appVersion?: string
    deviceInfo?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const code = typeof body.code === "string" ? body.code : ""
  if (!code.trim()) {
    return NextResponse.json({ error: "Введите код подключения", code: "enroll_code_required" }, { status: 400 })
  }

  const platform = typeof body.platform === "string" && body.platform.trim() ? body.platform.trim() : "android"
  const deviceUid =
    typeof body.deviceUid === "string" && body.deviceUid.trim()
      ? body.deviceUid.trim()
      : randomDeviceUid(platform === "mobile-web" ? "TSD" : "TSD")

  const client = await pool.connect()
  try {
    const origin = describeOrigin(req)
    const redeemed = await redeemEnrollCode(client, {
      code,
      deviceUid,
      deviceName: typeof body.deviceName === "string" ? body.deviceName : "",
      platform,
      appVersion: typeof body.appVersion === "string" ? body.appVersion : "",
      origin,
    })

    const device = await registerWmsDevice(client, redeemed.siteId, {
      deviceUid,
      deviceName: redeemed.deviceName,
      platform,
      appVersion: typeof body.appVersion === "string" ? body.appVersion : undefined,
      deviceInfo:
        body.deviceInfo && typeof body.deviceInfo === "object"
          ? { ...(body.deviceInfo as Record<string, unknown>), enrolledFrom: origin }
          : { enrolledFrom: origin },
    })

    const siteCode = await client
      .query<{ code: string }>(`SELECT code FROM wms_sites WHERE site_id = $1`, [redeemed.siteId])
      .then((r) => r.rows[0]?.code ?? "DEFAULT")
      .catch(() => "DEFAULT")

    return NextResponse.json({
      ok: true,
      device,
      deviceUid,
      deviceName: redeemed.deviceName,
      deviceToken: redeemed.deviceToken,
      siteCode,
    })
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error(error)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  } finally {
    client.release()
  }
}
