import { NextResponse } from "next/server"
import { readJson, withDocTemplates } from "@/lib/doc-templates/http"
import { discardDraft, saveDraft, type VersionContent } from "@/lib/doc-templates/store"
import { TemplateError, validateTemplate } from "@/lib/doc-templates/render"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

/**
 * Автосохранение редактора. Опубликованная версия не меняется: при первой правке
 * создаётся черновик со следующим номером версии.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return withDocTemplates(req, async ({ client, siteId, user, canEditRaw }) => {
    const body = await readJson<VersionContent & { name?: string; expectedDraftVersionId?: string | null }>(req)
    const version = await saveDraft(client, siteId, id, body, user, { canEditRaw })
    let validation: { ok: true } | { ok: false; error: string } = { ok: true }
    try {
      validateTemplate(String(body.jinjaTemplate ?? ""))
    } catch (e) {
      if (!(e instanceof TemplateError)) throw e
      validation = { ok: false, error: e.message }
    }
    return NextResponse.json({ version, validation })
  })
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return withDocTemplates(req, async ({ client, siteId }) => {
    await discardDraft(client, siteId, id)
    return NextResponse.json({ ok: true })
  })
}
