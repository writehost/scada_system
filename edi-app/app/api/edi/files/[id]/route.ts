import { route } from "@/lib/http.ts"
import { fileForActor, fileResponse } from "@/lib/edi/download.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor, params, req }) => {
  const f = await fileForActor(client, actor, params.id)
  return fileResponse(f, new URL(req.url).searchParams.get("inline") === "1")
})
