import { NextResponse } from "next/server"
import { errorResponse } from "@/lib/server/http.ts"
import { requirePlatformAdmin } from "@/lib/server/admin.ts"
import { isUuid, withSystem } from "@/lib/server/db.ts"
import { badRequest, notFound } from "@/lib/server/errors.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePlatformAdmin(req)
    const { id } = await ctx.params
    if (!isUuid(id)) throw badRequest("Неверный идентификатор")
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const status = String(body.status ?? "")
    if (!["trial", "active", "past_due", "expired", "cancelled"].includes(status)) throw badRequest("Статус подписки")
    const periodEnd = body.periodEnd ? new Date(String(body.periodEnd)) : null
    if (periodEnd && Number.isNaN(periodEnd.getTime())) throw badRequest("Дата окончания периода")
    await withSystem(async (c) => {
      const cur = (await c.query("SELECT plan_code, status FROM ems_subscriptions WHERE org_id = $1", [id])).rows[0]
      if (!cur) throw notFound("Подписка")
      const planCode = String(body.planCode ?? cur.plan_code)
      const plan = (await c.query("SELECT 1 FROM ems_plans WHERE plan_code = $1", [planCode])).rows[0]
      if (!plan) throw badRequest("Тариф не найден")
      const override = body.limitsOverride && typeof body.limitsOverride === "object" ? body.limitsOverride : {}
      await c.query(
        `UPDATE ems_subscriptions SET plan_code = $2, status = $3, current_period_end = $4, trial_ends_at = CASE WHEN $3 = 'trial' THEN COALESCE($4, trial_ends_at) ELSE trial_ends_at END,
                limits_override = $5::jsonb, note = $6, updated_at = now() WHERE org_id = $1`,
        [id, planCode, status, periodEnd, JSON.stringify(override), typeof body.note === "string" ? body.note.slice(0, 300) : null],
      )
      await c.query(
        `INSERT INTO ems_subscription_history (org_id, from_plan, to_plan, from_status, to_status, period_end, actor_id, reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, cur.plan_code, planCode, cur.status, status, periodEnd, admin.userId, typeof body.note === "string" ? body.note.slice(0, 300) : "изменено администратором"],
      )
      await audit(c, id, { kind: "user", id: admin.userId }, "subscription.admin_change", { type: "plan", id: planCode }, { status })
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
