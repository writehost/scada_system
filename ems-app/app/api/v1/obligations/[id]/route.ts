import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { conflict, notFound } from "@/lib/server/errors.ts"
import { updateObligation } from "@/lib/services/finance.ts"
import { obligationFromBody } from "@/lib/server/obligation-input.ts"
import { assertWritable } from "@/lib/services/subscription.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const PATCH = api({ perm: "finance.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    await updateObligation(c, ctx.orgId, ctx.actor, idParam(p.id), obligationFromBody(ctx.body, true))
    return { ok: true }
  }),
)

/** Отмена: scope=one — только это обязательство, scope=series — и все будущие неоплаченные в серии. */
export const DELETE = api({ perm: "finance.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    await assertWritable(c, ctx.orgId)
    const cur = (await c.query("SELECT series_id, status, due_date FROM ems_obligations WHERE obligation_id = $1 AND org_id = $2", [id, ctx.orgId])).rows[0]
    if (!cur) throw notFound("Платёж")
    if (cur.status === "paid") throw conflict("Оплаченный платёж не удаляется — сначала отмените отметку об оплате")
    const series = ctx.url.searchParams.get("scope") === "series"
    const r = series
      ? await c.query("UPDATE ems_obligations SET status = 'cancelled', updated_at = now() WHERE series_id = $1 AND org_id = $2 AND status = 'pending' AND due_date >= $3", [cur.series_id, ctx.orgId, cur.due_date])
      : await c.query("UPDATE ems_obligations SET status = 'cancelled', updated_at = now() WHERE obligation_id = $1", [id])
    await audit(c, ctx.orgId, ctx.actor, "obligation.cancel", { type: "obligation", id }, { series, count: r.rowCount })
    return { ok: true, cancelled: r.rowCount }
  }),
)
