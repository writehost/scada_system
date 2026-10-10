import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { notFound } from "@/lib/server/errors.ts"
import { assertWritable } from "@/lib/services/subscription.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const DELETE = api({ perm: "tariffs.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    await assertWritable(c, ctx.orgId)
    const r = await c.query("DELETE FROM ems_tariffs WHERE tariff_id = $1 AND org_id = $2 RETURNING account_id, name, valid_from", [id, ctx.orgId])
    if (!r.rows[0]) throw notFound("Тариф")
    await audit(c, ctx.orgId, ctx.actor, "tariff.delete", { type: "tariff", id }, r.rows[0])
    return { ok: true }
  }),
)
