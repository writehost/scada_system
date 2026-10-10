import { api } from "@/lib/server/http.ts"
import { intParam } from "@/lib/server/params.ts"
import { num, reqStr, timestamp } from "@/lib/server/validate.ts"
import { changeCoefficient } from "@/lib/services/assets.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "devices.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    await changeCoefficient(c, ctx.orgId, ctx.actor, intParam(p.id, "Канал"), {
      effectiveFrom: timestamp(ctx.body, "effectiveFrom", "Момент смены", true)!,
      multiplier: num(ctx.body, "multiplier", "Новый коэффициент", { required: true, min: 1e-9 })!,
      valueOffset: num(ctx.body, "valueOffset", "Смещение") ?? 0,
      boundaryRaw: num(ctx.body, "boundaryRaw", "Показание регистра в момент смены", { min: 0 }),
      reason: reqStr(ctx.body, "reason", "Причина", 300),
    })
    return { ok: true }
  }),
)
