import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { verifySessionToken } from "@/lib/auth/session"
import { bearerFromAuthorizationHeader } from "@/lib/auth/request-token"
import { WMS_SESSION_COOKIE } from "@/lib/auth/types"
import { guardProtectedApiRequest, isProtectedApiPath } from "@/lib/wms/api-request-guard"

const PUBLIC_PREFIXES = [
  "/login",
  "/api/app",
  "/api/auth",
  "/api/wms",
  "/api/catalog",
  "/api/fg",
  "/api/s",
  "/s",
  "/mobile",
  "/pos-terminal",
  "/embed",
  "/help",
  "/welcome",
  "/gsmt",
  "/packages",
  "/warehouse-plan",
]

const PUBLIC_EXACT = new Set(["/favicon.ico", "/icon.svg"])

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  if (pathname.startsWith("/_next")) return true
  if (pathname.startsWith("/wms-item-images")) return true
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico|js|css|html|map|woff2?|ttf|apk)$/i.test(pathname)) return true
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

async function resolveSession(request: NextRequest) {
  const bearer = bearerFromAuthorizationHeader(request.headers.get("authorization"))
  const cookieToken = request.cookies.get(WMS_SESSION_COOKIE)?.value
  const token = bearer || cookieToken
  if (!token) return null
  return verifySessionToken(token)
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isProtectedApiPath(pathname)) {
    const blocked = await guardProtectedApiRequest(request)
    if (blocked) return blocked
    return NextResponse.next()
  }

  const session = await resolveSession(request)

  if (isPublicPath(pathname)) {
    if (pathname === "/login" && session) {
      return NextResponse.redirect(new URL("/", request.url))
    }
    return NextResponse.next()
  }

  if (!session) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
}
