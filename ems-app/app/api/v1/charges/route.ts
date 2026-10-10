// Фактическое начисление из квитанции поставщика.
import { api } from "@/lib/server/http.ts"
import { dateKey, num, str, uuid } from "@/lib/server/validate.ts"
import { upsertActualCharge } from "@/lib/services/finance.ts"
import { optUuid } from "@/lib/server/params.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const r = await c.query(
      `SELECT ch.charge_id, ch.account_id, a.title, a.service, ch.period, ch.amount, ch.source, ch.quantity, ch.note, ch.created_at FROM ems_charges ch JOIN ems_accounts a ON a.account_id = ch.account_id
        WHERE ch.org_id = $1 AND ($2::uuid IS NULL OR a.site_id = $2) ORDER BY ch.period DESC, a.title LIMIT 200`,
      [ctx.orgId, optUuid(ctx.url, "siteId")],
    )
    return { charges: r.rows }
  }),
)

export const POST = api({ perm: "finance.write" }, async (ctx) =>
  ctx.tx(async (c) => {
    await upsertActualCharge(c, ctx.orgId, ctx.actor, {
      accountId: uuid(ctx.body, "accountId", "Лицевой счёт", true)!,
      period: dateKey(ctx.body, "period", "Месяц", true)!,
      amount: num(ctx.body, "amount", "Сумма", { required: true, min: 0, max: 1e10 })!,
      quantity: num(ctx.body, "quantity", "Количество", { min: 0 }),
      note: str(ctx.body, "note", "Примечание", { max: 300 }),
    })
    return { ok: true }
  }),
)
