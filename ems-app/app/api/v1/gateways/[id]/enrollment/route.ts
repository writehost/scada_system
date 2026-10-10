import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { issueEnrollment } from "@/lib/services/gateways.ts"
import { assertWritable } from "@/lib/services/subscription.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "devices.write", rate: 20 }, async (ctx, p) =>
  ctx.tx(async (c) => {
    await assertWritable(c, ctx.orgId)
    return issueEnrollment(c, ctx.orgId, ctx.actor, idParam(p.id))
  }),
)
