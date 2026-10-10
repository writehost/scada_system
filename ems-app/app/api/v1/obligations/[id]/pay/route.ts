import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { dateKey, num, str } from "@/lib/server/validate.ts"
import { markPaid } from "@/lib/services/finance.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "finance.write" }, async (ctx, p) =>
  ctx.tx((c) =>
    markPaid(c, ctx.orgId, ctx.actor, idParam(p.id), {
      amount: num(ctx.body, "amount", "Сумма оплаты", { required: true, min: 0, max: 1e10 })!,
      paidOn: dateKey(ctx.body, "paidOn", "Дата оплаты", true)!,
      note: str(ctx.body, "note", "Примечание", { max: 300 }),
    }),
  ),
)
