import { api } from "@/lib/server/http.ts"
import { dateKey, reqStr, str, uuid } from "@/lib/server/validate.ts"
import { createTariff } from "@/lib/services/finance.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "tariffs.write" }, async (ctx) =>
  ctx.tx(async (c) => ({
    tariffId: await createTariff(c, ctx.orgId, ctx.actor, {
      accountId: uuid(ctx.body, "accountId", "Лицевой счёт", true)!,
      name: reqStr(ctx.body, "name", "Название тарифа", 120),
      kind: reqStr(ctx.body, "kind", "Вид тарифа", 20),
      validFrom: dateKey(ctx.body, "validFrom", "Действует с", true)!,
      validTo: dateKey(ctx.body, "validTo", "Действует по"),
      config: ctx.body.config,
      sourceNote: str(ctx.body, "sourceNote", "Источник", { max: 300 }),
    }),
  })),
)
