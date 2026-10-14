import { signPayload } from "@/lib/auth/session.ts"
import { route } from "@/lib/http.ts"
import { fileForActor } from "@/lib/edi/download.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Временная ссылка (10 минут) — например, открыть файл в SCADA Mobile. Права проверяются при каждом открытии. */
export const POST = route(async ({ client, actor, params }) => {
  await fileForActor(client, actor, params.id)
  const exp = Date.now() + 10 * 60 * 1000
  const token = await signPayload({ f: params.id, s: actor.siteId, u: actor.userId, exp, k: "file" })
  return { url: `/api/edi/files/shared/${encodeURIComponent(token)}`, expiresAt: new Date(exp).toISOString() }
})
