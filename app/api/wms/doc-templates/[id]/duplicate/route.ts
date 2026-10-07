import { NextResponse } from "next/server"
import { withDocTemplates } from "@/lib/doc-templates/http"
import { duplicateTemplate } from "@/lib/doc-templates/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withDocTemplates(req, async ({ client, siteId, user }) => {
    return NextResponse.json(await duplicateTemplate(client, siteId, id, user), { status: 201 })
  })
}
