import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Страницы требуют сессию; API проверяют её сами (включая Bearer для мобильного клиента и шлюзов).
const PUBLIC = ["/login", "/email/verify", "/api/", "/_next/", "/icon.svg", "/favicon.ico"]

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next()
  if (!req.cookies.get("ems_session")?.value) {
    const url = req.nextUrl.clone()
    url.pathname = "/login"
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : ""
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] }
