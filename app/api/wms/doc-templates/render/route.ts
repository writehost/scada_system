import { NextResponse } from "next/server"
import { WmsHttpError } from "@/lib/wms/errors"
import { htmlResponse, pdfResponse, readJson, withDocTemplates } from "@/lib/doc-templates/http"
import { renderPdf } from "@/lib/doc-templates/pdf"
import { decoratePreviewHtml, renderTemplate, validateTemplate } from "@/lib/doc-templates/render"
import { sanitizeTemplateHtml } from "@/lib/doc-templates/jinja/sanitize"
import { resolvePreviewData } from "@/lib/doc-templates/wms-context"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Рендер несохранённого Jinja из редактора: { jinja, kind, sampleId | documentId, format }.
 * format=validate — только проверка шаблона.
 */
export async function POST(req: Request) {
  return withDocTemplates(req, async (c) => {
    const body = await readJson<{ jinja?: string; kind?: string; sampleId?: string; documentId?: string; format?: string; title?: string }>(req)
    if (typeof body.jinja !== "string" || !body.jinja.trim()) throw new WmsHttpError(400, "jinja is required")
    const jinja = sanitizeTemplateHtml(body.jinja).html
    if (body.format === "validate") {
      validateTemplate(jinja)
      return NextResponse.json({ ok: true })
    }
    const data = await resolvePreviewData(c.client, c.siteId, body.kind ?? "trade", { sampleId: body.sampleId, documentId: body.documentId }, c.origin)
    const html = renderTemplate(jinja, data, { printUser: c.user ?? "" })
    if (body.format === "pdf") return pdfResponse(await renderPdf(html), `${body.title || "Документ"}.pdf`)
    return htmlResponse(decoratePreviewHtml(html))
  })
}
