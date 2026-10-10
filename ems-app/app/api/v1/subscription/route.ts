import { api } from "@/lib/server/http.ts"
import { getSubscription, usage } from "@/lib/services/subscription.ts"
import { LIMIT_LABELS, nearLimit } from "@/lib/domain/plans.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const sub = await getSubscription(c, ctx.orgId)
    const used = await usage(c, ctx.orgId)
    const plans = await c.query("SELECT plan_code, segment, name, description, price_month, limits, features, is_trial FROM ems_plans WHERE is_public AND segment = $1 ORDER BY sort", [sub.segment])
    const history = await c.query(
      `SELECT h.from_plan, h.to_plan, h.from_status, h.to_status, h.period_end, h.reason, h.created_at, u.display_name AS actor FROM ems_subscription_history h LEFT JOIN ems_users u ON u.user_id = h.actor_id
        WHERE h.org_id = $1 ORDER BY h.created_at DESC LIMIT 50`,
      [ctx.orgId],
    )
    const warnings = Object.entries(sub.limits)
      .filter(([k, v]) => k in used && nearLimit(v as number | null, used[k]))
      .map(([k, v]) => ({ key: k, label: LIMIT_LABELS[k as keyof typeof LIMIT_LABELS], used: used[k], limit: v }))
    return { subscription: sub, usage: used, plans: plans.rows, history: history.rows, warnings, limitLabels: LIMIT_LABELS }
  }),
)
