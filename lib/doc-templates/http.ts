import { NextResponse } from "next/server"
import type { PoolClient } from "pg"
import { getRequestSession } from "@/lib/auth/request-session"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { WmsHttpError, wmsErrorResponse } from "@/lib/wms/errors"
import { ensureDocTemplateTables } from "./store.ts"
import { TemplateError } from "./render.ts"
import { PdfUnavailableError } from "./pdf.ts"

export type DocTemplateCtx = {
  client: PoolClient
  siteId: number
  user: string | null
  /** Advanced Jinja (сырые блоки) правит только администратор. */
  canEditRaw: boolean
  origin: string
}

export async function withDocTemplates(req: Request, fn: (ctx: DocTemplateCtx) => Promise<Response>): Promise<Response> {
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode") ?? ""
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  const session = await getRequestSession().catch(() => null)
  const roles = session?.roleCodes ?? []
  const canEditRaw = roles.includes("admin") || /админ/i.test(session?.position ?? "")
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await ensureDocTemplateTables(client)
    return await fn({ client, siteId, user: session?.fio || session?.login || null, canEditRaw, origin: url.origin })
  } catch (e) {
    if (e instanceof TemplateError) return NextResponse.json({ error: e.message, code: "template_error", line: e.line }, { status: 422 })
    if (e instanceof PdfUnavailableError) return NextResponse.json({ error: e.message, code: "pdf_unavailable" }, { status: 503 })
    if (e instanceof WmsHttpError) return wmsErrorResponse(e)
    return wmsErrorResponse(e)
  } finally {
    client.release()
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new WmsHttpError(400, "invalid json")
  }
}

/**
 * Отрендеренный документ показывается в iframe предпросмотра.
 * CSP запрещает любые скрипты и внешние запросы — даже если данные содержат разметку.
 */
export function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  })
}

export function pdfResponse(pdf: Buffer, fileName: string): Response {
  const ascii = fileName.replace(/[^\w.-]+/g, "_") || "document.pdf"
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  })
}
