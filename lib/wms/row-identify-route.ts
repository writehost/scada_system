import { NextResponse } from "next/server"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"
import { requireWmsActor, type WmsActor } from "@/lib/wms/require-actor"
import { resolveRowIdentifyAuth, type FgMapTokenPayload } from "@/lib/wms/row-identify-token"
import type { WmsAuthSession } from "@/lib/auth/types"

export type RowIdentifyAccess =
  | { ok: true; via: "map-token"; token: FgMapTokenPayload }
  | { ok: true; via: "session"; session: WmsAuthSession }
  | { ok: true; via: "device"; actor: WmsActor }
  | { ok: false; error: string; status: number }

/**
 * Карта/телефон — map-token или сессия WMS.
 * ТСД — токен терминала (`x-device-token`) или зарегистрированный `deviceUid`
 * (`x-device-uid` / тело запроса), тот же допуск, что у apply.
 */
export async function authorizeRowIdentify(
  req: Request,
  siteCode?: string | null
): Promise<RowIdentifyAccess> {
  const mapOrSession = await resolveRowIdentifyAuth(req)
  if (mapOrSession.ok) return mapOrSession

  const actorGate = await requireWmsActor(req, {
    allowRegisteredDevice: true,
    siteCode: siteCode?.trim() || undefined,
  })
  if (!("error" in actorGate)) {
    return { ok: true, via: "device", actor: actorGate.actor }
  }
  return mapOrSession
}

export async function withRowIdentify(
  req: Request,
  siteCodeRaw: string | null | undefined,
  handler: (
    client: import("pg").PoolClient,
    siteId: number,
    auth:
      | { via: "map-token"; token: FgMapTokenPayload }
      | { via: "session"; session: WmsAuthSession }
      | { via: "device"; actor: WmsActor }
  ) => Promise<NextResponse>
) {
  const auth = await authorizeRowIdentify(req, siteCodeRaw)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const siteCode =
    (siteCodeRaw ?? "").trim() ||
    (auth.via === "map-token" ? auth.token.siteCode : "") ||
    "DEFAULT"

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })

  const client = conn.client
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    return await handler(client, siteId, auth)
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 500
    const message =
      status >= 500 ? wmsDbErrorToUserMessage(error) || "internal error" : error instanceof Error ? error.message : "error"
    if (status >= 500) console.error("[row-identify]", error)
    return NextResponse.json({ error: message }, { status })
  } finally {
    client.release()
  }
}

export function requestOrigin(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "https"
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "scada25.ru"
  return `${proto}://${host}`
}
