import { NextResponse } from "next/server"
import { withDocTemplates } from "@/lib/doc-templates/http"
import { listVersions, publishDraft } from "@/lib/doc-templates/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Черновик → published, прежняя опубликованная версия → archived. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withDocTemplates(req, async ({ client, siteId, user }) => {
    const version = await publishDraft(client, siteId, id, user)
    return NextResponse.json({ version, versions: await listVersions(client, id) })
  })
}
