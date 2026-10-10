import { api } from "@/lib/server/http.ts"
import { bool, oneOf, str } from "@/lib/server/validate.ts"
import { audit } from "@/lib/services/audit.ts"
import { getSubscription, usage } from "@/lib/services/subscription.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const org = (await c.query("SELECT org_id, name, kind, segment, timezone, is_demo, onboarding_done, created_at FROM ems_organizations WHERE org_id = $1", [ctx.orgId])).rows[0]
    return { org, role: ctx.role, subscription: await getSubscription(c, ctx.orgId), usage: await usage(c, ctx.orgId) }
  }),
)

export const PATCH = api({ perm: "org.manage" }, async (ctx) =>
  ctx.tx(async (c) => {
    const name = str(ctx.body, "name", "Название", { max: 120 })
    const segment = ctx.body.segment != null ? oneOf(ctx.body, "segment", "Режим", ["home", "industrial"] as const) : null
    const onboarding = ctx.body.onboardingDone != null ? bool(ctx.body, "onboardingDone") : null
    await c.query(
      `UPDATE ems_organizations SET name = COALESCE($2, name), segment = COALESCE($3, segment), onboarding_done = COALESCE($4, onboarding_done) WHERE org_id = $1`,
      [ctx.orgId, name, segment, onboarding],
    )
    await audit(c, ctx.orgId, ctx.actor, "org.update", { type: "org", id: ctx.orgId }, { name, segment, onboarding })
    return { ok: true }
  }),
)
