import { jsonBody, route } from "@/lib/http.ts"
import { decide } from "@/lib/edi/workflow.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = route(async ({ client, actor, params, req }) => {
  const b = await jsonBody<{ decision: string; comment?: string }>(req)
  return decide(client, actor, params.id, String(b.decision), b.comment)
}, { tx: true })
