import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { notFound } from "@/lib/server/errors.ts"
import { num, str } from "@/lib/server/validate.ts"
import { findOrCreateProvider } from "@/lib/services/finance.ts"
import { assertWritable } from "@/lib/services/subscription.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const PATCH = api({ perm: "tariffs.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    await assertWritable(c, ctx.orgId)
    const providerName = str(ctx.body, "providerName", "Поставщик", { max: 120 })
    const providerId = providerName ? await findOrCreateProvider(c, ctx.orgId, providerName) : null
    const r = await c.query(
      `UPDATE ems_accounts SET title = COALESCE($3, title), account_number = COALESCE($4, account_number), provider_id = COALESCE($5, provider_id),
              budget_month = CASE WHEN $6::boolean THEN $7 ELSE budget_month END WHERE account_id = $1 AND org_id = $2 RETURNING account_id`,
      [id, ctx.orgId, str(ctx.body, "title", "Название", { max: 120 }), str(ctx.body, "accountNumber", "Лицевой счёт", { max: 60 }), providerId, "budgetMonth" in ctx.body, num(ctx.body, "budgetMonth", "Бюджет", { min: 0 })],
    )
    if (!r.rows[0]) throw notFound("Лицевой счёт")
    await audit(c, ctx.orgId, ctx.actor, "account.update", { type: "account", id })
    return { ok: true }
  }),
)

export const DELETE = api({ perm: "tariffs.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const r = await c.query("UPDATE ems_accounts SET archived_at = now() WHERE account_id = $1 AND org_id = $2 AND archived_at IS NULL RETURNING account_id", [id, ctx.orgId])
    if (!r.rows[0]) throw notFound("Лицевой счёт")
    await audit(c, ctx.orgId, ctx.actor, "account.archive", { type: "account", id })
    return { ok: true }
  }),
)
