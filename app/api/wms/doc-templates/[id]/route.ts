import { NextResponse } from "next/server"
import { readJson, withDocTemplates } from "@/lib/doc-templates/http"
import { getTemplateSummary, getWorkingVersion, listVersions, updateTemplateMeta } from "@/lib/doc-templates/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

/** Шаблон для редактора: метаданные, история версий и рабочая версия (черновик или опубликованная). */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return withDocTemplates(req, async ({ client, siteId, canEditRaw }) => {
    const template = await getTemplateSummary(client, siteId, id)
    const [versions, working] = await Promise.all([listVersions(client, id), getWorkingVersion(client, id)])
    return NextResponse.json({ template, versions, working, permissions: { editRawJinja: canEditRaw } })
  })
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return withDocTemplates(req, async ({ client, siteId }) => {
    const body = await readJson<{ name?: string; docTypeLabel?: string; description?: string; archived?: boolean }>(req)
    await updateTemplateMeta(client, siteId, id, body)
    return NextResponse.json({ template: await getTemplateSummary(client, siteId, id) })
  })
}
