import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/d/") ||
    pathname.startsWith("/api/driver/")
  ) {
    return NextResponse.next()
  }
  const token = req.cookies.get("yms_session")?.value
  if (!token && pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Нужен вход в YMS", code: "auth_required" }, { status: 401 })
  }
  if (!token) {
    const url = req.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
