import { route } from "@/lib/http.ts"
import { readUploads } from "@/lib/multipart.ts"
import { ingestFiles, listImports } from "@/lib/edi/import.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor, req }) => ({ imports: await listImports(client, actor, new URL(req.url).searchParams.get("status") ?? undefined) }))

export const POST = route(async ({ client, actor, req }) => {
  const { files } = await readUploads(req, "file", 50)
  return { imports: await ingestFiles(client, actor, files) }
}, { tx: true })
