import { assertSameOrigin } from "./lib/auth/csrf.ts"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const PUBLIC = ["/login", "/api/health", "/api/auth/login", "/api/auth/providers", "/api/auth/scada-id/", "/api/edi/files/shared/"]

/** Быстрый отсев без сессии; подпись и права проверяет каждый маршрут API на сервере. */
export function proxy(req: NextRequest) {
  try { assertSameOrigin(req) } catch { return NextResponse.json({ error: "Запрос должен выполняться с сайта SCADA EDI" }, { status: 403 }) }
  const { pathname } = req.nextUrl
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next()
  const hasCookie = Boolean(req.cookies.get("edi_session")?.value)
  const hasBearer = /^Bearer\s+\S+/i.test(req.headers.get("authorization") || "")
  if (pathname.startsWith("/api/")) {
    if (!hasCookie && !hasBearer) return NextResponse.json({ error: "Нужен вход в SCADA EDI", code: "auth_required" }, { status: 401 })
    return NextResponse.next()
  }
  if (!hasCookie) {
    const url = req.nextUrl.clone()
    url.pathname = "/login"
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] }
