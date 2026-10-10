import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { notFound } from "@/lib/server/errors.ts"
import { bool, num, str } from "@/lib/server/validate.ts"
import { validateParams, type RuleKind } from "@/lib/services/rules.ts"
import { assertWritable } from "@/lib/services/subscription.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const PATCH = api({ perm: "rules.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    await assertWritable(c, ctx.orgId)
    const cur = (await c.query("SELECT * FROM ems_alert_rules WHERE rule_id = $1 AND org_id = $2", [id, ctx.orgId])).rows[0]
    if (!cur) throw notFound("Правило")
    const params = ctx.body.params !== undefined ? validateParams(cur.kind as RuleKind, ctx.body.params) : cur.params
    await c.query(
      `UPDATE ems_alert_rules SET name = COALESCE($3, name), params = $4::jsonb, enabled = $5, notify = $6, severity = COALESCE($7, severity),
              repeat_minutes = CASE WHEN $8::boolean THEN $9 ELSE repeat_minutes END, updated_at = now() WHERE rule_id = $1 AND org_id = $2`,
      [id, ctx.orgId, str(ctx.body, "name", "Название", { max: 120 }), JSON.stringify(params), bool(ctx.body, "enabled", cur.enabled), bool(ctx.body, "notify", cur.notify),
        ["info", "warning", "critical"].includes(String(ctx.body.severity)) ? ctx.body.severity : null, "repeatMinutes" in ctx.body, num(ctx.body, "repeatMinutes", "Повтор", { min: 15, max: 10080, integer: true })],
    )
    await audit(c, ctx.orgId, ctx.actor, "rule.update", { type: "rule", id })
    return { ok: true }
  }),
)

export const DELETE = api({ perm: "rules.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const r = await c.query("DELETE FROM ems_alert_rules WHERE rule_id = $1 AND org_id = $2 RETURNING kind", [id, ctx.orgId])
    if (!r.rows[0]) throw notFound("Правило")
    await audit(c, ctx.orgId, ctx.actor, "rule.delete", { type: "rule", id }, r.rows[0])
    return { ok: true }
  }),
)
