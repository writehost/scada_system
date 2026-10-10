import { api } from "@/lib/server/http.ts"
import { optUuid } from "@/lib/server/params.ts"
import { num, oneOf, str, uuid } from "@/lib/server/validate.ts"
import { createAccount, } from "@/lib/services/finance.ts"
import { listAccounts, accountTariffs } from "@/lib/services/billing.ts"
import { SERVICES } from "@/lib/domain/tariffs.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const accounts = await listAccounts(c, ctx.orgId, optUuid(ctx.url, "siteId"))
    const out = []
    for (const a of accounts) out.push({ ...a, tariffs: await accountTariffs(c, a.account_id) })
    return { accounts: out }
  }),
)

export const POST = api({ perm: "tariffs.write" }, async (ctx) =>
  ctx.tx(async (c) => ({
    accountId: await createAccount(c, ctx.orgId, ctx.actor, {
      siteId: uuid(ctx.body, "siteId", "Объект", true)!,
      service: oneOf(ctx.body, "service", "Услуга", SERVICES),
      title: str(ctx.body, "title", "Название", { max: 120 }),
      providerName: str(ctx.body, "providerName", "Поставщик", { max: 120 }),
      accountNumber: str(ctx.body, "accountNumber", "Лицевой счёт", { max: 60 }),
      calcMethod: oneOf(ctx.body, "calcMethod", "Способ расчёта", ["meter", "fixed", "manual"] as const),
      budgetMonth: num(ctx.body, "budgetMonth", "Бюджет в месяц", { min: 0, max: 1e10 }),
    }),
  })),
)
