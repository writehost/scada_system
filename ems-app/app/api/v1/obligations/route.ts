import { api } from "@/lib/server/http.ts"
import { optUuid } from "@/lib/server/params.ts"
import { createObligation, listObligations, type ObligationInput } from "@/lib/services/finance.ts"
import { obligationFromBody } from "@/lib/server/obligation-input.ts"
import { isDateKey, localDateKey } from "@/lib/domain/time.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const tz = (await c.query("SELECT timezone FROM ems_organizations WHERE org_id = $1", [ctx.orgId])).rows[0]?.timezone ?? "Europe/Moscow"
    const today = localDateKey(Date.now(), tz)
    const from = ctx.url.searchParams.get("from")
    const to = ctx.url.searchParams.get("to")
    return {
      today,
      items: await listObligations(c, ctx.orgId, { from: from && isDateKey(from) ? from : null, to: to && isDateKey(to) ? to : null, siteId: optUuid(ctx.url, "siteId"), status: ctx.url.searchParams.get("status") }, today),
    }
  }),
)

export const POST = api({ perm: "finance.write" }, async (ctx) =>
  ctx.tx(async (c) => ({ obligationId: await createObligation(c, ctx.orgId, ctx.actor, obligationFromBody(ctx.body) as ObligationInput) })),
)
