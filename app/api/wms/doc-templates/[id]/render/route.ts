import { WmsHttpError } from "@/lib/wms/errors"
import { htmlResponse, pdfResponse, readJson, withDocTemplates, type DocTemplateCtx } from "@/lib/doc-templates/http"
import { renderPdf } from "@/lib/doc-templates/pdf"
import { decoratePreviewHtml, renderTemplate } from "@/lib/doc-templates/render"
import { getPublishedVersion, getTemplateSummary, getVersion, getWorkingVersion, type TemplateVersion } from "@/lib/doc-templates/store"
import { resolvePreviewData } from "@/lib/doc-templates/wms-context"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

async function pickVersion(ctx: DocTemplateCtx, id: string, which: string): Promise<TemplateVersion> {
  let v: TemplateVersion | null
  if (which === "published") v = await getPublishedVersion(ctx.client, ctx.siteId, id)
  else if (which === "working" || which === "draft" || !which) v = await getWorkingVersion(ctx.client, id)
  else v = await getVersion(ctx.client, ctx.siteId, id, which)
  if (!v) throw new WmsHttpError(404, which === "published" ? "У шаблона нет опубликованной версии" : "Версия не найдена", "version_not_found")
  return v
}

async function respond(ctx: DocTemplateCtx, id: string, version: TemplateVersion, data: Record<string, unknown>, format: string) {
  const html = renderTemplate(version.jinjaTemplate, data, { printUser: ctx.user ?? "" })
  if (format === "pdf") {
    const summary = await getTemplateSummary(ctx.client, ctx.siteId, id)
    return pdfResponse(await renderPdf(html), `${summary.name} v${version.versionNo}.pdf`)
  }
  if (format === "raw") return htmlResponse(html)
  return htmlResponse(decoratePreviewHtml(html))
}

/**
 * Предпросмотр / PDF: ?version=working|published|<versionId>&sample=<id>|documentId=<id>&format=html|pdf.
 * Тот же renderer, что и в production.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const q = new URL(req.url).searchParams
  return withDocTemplates(req, async (c) => {
    const summary = await getTemplateSummary(c.client, c.siteId, id)
    const version = await pickVersion(c, id, q.get("version") ?? "working")
    const data = await resolvePreviewData(
      c.client,
      c.siteId,
      summary.docKind,
      { sampleId: q.get("sample") ?? version.sampleId, documentId: q.get("documentId") },
      c.origin
    )
    return respond(c, id, version, data, q.get("format") ?? "html")
  })
}

/**
 * Печать из других модулей (WMS/QMS/MES): POST { data, format } — опубликованная версия
 * с переданными данными документа. { documentId } — данные документа WMS.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return withDocTemplates(req, async (c) => {
    const body = await readJson<{ data?: Record<string, unknown>; documentId?: string; version?: string; format?: string }>(req)
    const summary = await getTemplateSummary(c.client, c.siteId, id)
    const version = await pickVersion(c, id, body.version ?? "published")
    let data = body.data
    if (!data && body.documentId) data = await resolvePreviewData(c.client, c.siteId, summary.docKind, { documentId: body.documentId }, c.origin)
    if (!data || typeof data !== "object") throw new WmsHttpError(400, "Нужны data или documentId")
    return respond(c, id, version, data, body.format ?? "pdf")
  })
}
