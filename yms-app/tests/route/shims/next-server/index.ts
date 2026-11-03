// Тестовая замена `next/server` (только для стенда без доступа к npm): NextResponse поверх Web Response.
export class NextResponse extends Response {
  static json(body: unknown, init: ResponseInit = {}): NextResponse {
    const headers = new Headers(init.headers)
    if (!headers.has("content-type")) headers.set("content-type", "application/json")
    return new NextResponse(JSON.stringify(body), { ...init, headers })
  }
  static next(): NextResponse {
    return new NextResponse(null, { status: 200, headers: { "x-middleware-next": "1" } })
  }
  static redirect(url: string | URL, status = 307): NextResponse {
    return new NextResponse(null, { status, headers: { location: String(url) } })
  }
  get cookies() {
    const headers = this.headers
    return {
      set(name: string, value: string, opts: { path?: string; maxAge?: number; httpOnly?: boolean } = {}) {
        const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? "/"}`]
        if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`)
        if (opts.httpOnly) parts.push("HttpOnly")
        headers.append("set-cookie", parts.join("; "))
      },
    }
  }
}
export type NextRequest = Request & { nextUrl: URL; cookies: { get(name: string): { value: string } | undefined } }
