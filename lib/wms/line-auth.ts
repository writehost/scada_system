import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { isLocalRequest } from "@/lib/wms/local-request"
import { requireWmsActor } from "@/lib/wms/require-actor"

function secretsEqual(expected: string, provided: string): boolean {
  const left = Buffer.from(expected)
  const right = Buffer.from(provided)
  if (left.length !== right.length) {
    if (left.length > 0) timingSafeEqual(left, left)
    return false
  }
  return timingSafeEqual(left, right)
}

function readLineSecret(req: Request): string {
  const header = req.headers.get("x-wms-line-secret")?.trim() || ""
  if (header) return header
  const authorization = req.headers.get("authorization") || ""
  if (/^Line\s+/i.test(authorization)) return authorization.replace(/^Line\s+/i, "").trim()
  return ""
}

/**
 * Линия / цех / внешний APS: сессия, токен ТСД, зарегистрированный терминал,
 * секрет `WMS_LINE_API_SECRET` или локальный cron.
 */
export async function requireLineApi(req: Request): Promise<NextResponse | null> {
  const secret = process.env.WMS_LINE_API_SECRET?.trim() || ""
  const provided = readLineSecret(req)
  if (secret && provided && secretsEqual(secret, provided)) {
    return null
  }
  if (isLocalRequest(req)) return null
  const gate = await requireWmsActor(req, { allowRegisteredDevice: true })
  return "error" in gate ? gate.error : null
}
