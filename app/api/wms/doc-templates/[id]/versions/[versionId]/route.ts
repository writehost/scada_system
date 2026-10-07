import { NextResponse } from "next/server"
import { readJson, withDocTemplates } from "@/lib/doc-templates/http"
import { getVersion, listVersions, restoreVersionToDraft } from "@/lib/doc-templates/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string; versionId: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const { id, versionId } = await ctx.params
  return withDocTemplates(req, async ({ client, siteId }) => {
    return NextResponse.json({ version: await getVersion(client, siteId, id, versionId) })
  })
}

/** { action: "restore" } — скопировать версию в черновик. */
export async function POST(req: Request, ctx: Ctx) {
  const { id, versionId } = await ctx.params
  return withDocTemplates(req, async ({ client, siteId, user }) => {
    const body = await readJson<{ action?: string }>(req)
    if (body.action !== "restore") return NextResponse.json({ error: "unknown action" }, { status: 400 })
    const version = await restoreVersionToDraft(client, siteId, id, versionId, user)
    return NextResponse.json({ version, versions: await listVersions(client, id) })
  })
}
