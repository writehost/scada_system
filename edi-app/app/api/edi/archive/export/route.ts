import { jsonBody, route } from "@/lib/http.ts"
import { exportArchive } from "@/lib/edi/archive.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = route(async ({ client, actor, req }) => {
  const b = await jsonBody<{ ids: string[] }>(req)
  const { zip, name } = await exportArchive(client, actor, Array.isArray(b.ids) ? b.ids.map(String) : [])
  return new Response(Buffer.from(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  })
})
