import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { undoPaid } from "@/lib/services/finance.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "finance.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    await undoPaid(c, ctx.orgId, ctx.actor, idParam(p.id))
    return { ok: true }
  }),
)
