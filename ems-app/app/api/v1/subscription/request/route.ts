// Запрос смены тарифа. Онлайн-оплата не подключена: заявка фиксируется в истории
// и активируется администратором платформы после оплаты по счёту.
import { api } from "@/lib/server/http.ts"
import { badRequest } from "@/lib/server/errors.ts"
import { reqStr, str } from "@/lib/server/validate.ts"
import { getSubscription } from "@/lib/services/subscription.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "subscription.manage", rate: 10 }, async (ctx) =>
  ctx.tx(async (c) => {
    const planCode = reqStr(ctx.body, "planCode", "Тариф", 40)
    const sub = await getSubscription(c, ctx.orgId)
    const plan = (await c.query("SELECT plan_code, segment, name FROM ems_plans WHERE plan_code = $1 AND is_public AND NOT is_trial", [planCode])).rows[0]
    if (!plan || plan.segment !== sub.segment) throw badRequest("Тариф недоступен для этой организации")
    await c.query(
      `INSERT INTO ems_subscription_history (org_id, from_plan, to_plan, from_status, to_status, actor_id, reason) VALUES ($1, $2, $3, $4, $4, $5, $6)`,
      [ctx.orgId, sub.planCode, planCode, sub.storedStatus, ctx.user?.userId ?? null, `заявка на подключение: ${str(ctx.body, "comment", "Комментарий", { max: 300 }) ?? "без комментария"}`],
    )
    await audit(c, ctx.orgId, ctx.actor, "subscription.request", { type: "plan", id: planCode })
    return { ok: true, message: `Заявка на тариф «${plan.name}» принята. Онлайн-оплата пока не подключена: менеджер пришлёт счёт, после оплаты тариф активируется.` }
  }),
)
