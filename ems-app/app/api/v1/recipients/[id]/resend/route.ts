import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { resendVerification } from "@/lib/services/recipients.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "notifications.manage", rate: 10 }, async (ctx, p) =>
  ctx.tx(async (c) => {
    await resendVerification(c, ctx.orgId, ctx.actor, idParam(p.id))
    return { ok: true }
  }),
)
