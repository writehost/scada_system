import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import type { LabelOrderAuthor } from "@/lib/wms/label-order-docs"

/**
 * «Кто создал» в документе заказа берётся из сессии WMS, а не из тела запроса:
 * подписать чужим именем через API нельзя.
 */
export async function resolveLabelOrderAuthor(req: Request): Promise<LabelOrderAuthor> {
  try {
    const token = await readAuthTokenFromRequest(req)
    if (!token) return { login: "", fio: "", position: "" }
    const session = await verifySessionToken(token)
    if (!session) return { login: "", fio: "", position: "" }
    return {
      login: session.login ?? "",
      fio: session.fio ?? "",
      position: session.position ?? "",
    }
  } catch {
    return { login: "", fio: "", position: "" }
  }
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? ""
  const first = forwarded.split(",")[0]?.trim()
  return first || req.headers.get("x-real-ip")?.trim() || ""
}

function browserLabel(userAgent: string): string {
  const ua = userAgent.toLowerCase()
  if (ua.includes("android")) return "Android"
  if (ua.includes("iphone") || ua.includes("ipad")) return "iOS"
  if (ua.includes("edg/")) return "Edge"
  if (ua.includes("yabrowser")) return "Яндекс.Браузер"
  if (ua.includes("firefox")) return "Firefox"
  if (ua.includes("chrome")) return "Chrome"
  if (ua.includes("safari")) return "Safari"
  return ""
}

/** «Откуда создан»: рабочее место оператора в человекочитаемом виде. */
export function describeRequestOrigin(req: Request): string {
  const bits: string[] = ["интерфейс WMS"]
  const browser = browserLabel(req.headers.get("user-agent") ?? "")
  if (browser) bits.push(browser)
  const ip = clientIp(req)
  if (ip) bits.push(`IP ${ip}`)
  return bits.join(" · ")
}
