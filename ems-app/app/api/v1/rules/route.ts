import { api } from "@/lib/server/http.ts"
import { optUuid } from "@/lib/server/params.ts"
import { bool, num, oneOf, str, uuid } from "@/lib/server/validate.ts"
import { createRule, RULE_KINDS, RULE_LABELS } from "@/lib/services/rules.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const r = await c.query(
      `SELECT r.*, s.name AS site_name, m.name AS meter_name,
              (SELECT count(*) FROM ems_events e WHERE e.rule_id = r.rule_id AND e.status = 'open')::int AS open_events
         FROM ems_alert_rules r LEFT JOIN ems_sites s ON s.site_id = r.site_id LEFT JOIN ems_meters m ON m.meter_id = r.meter_id
        WHERE r.org_id = $1 AND ($2::uuid IS NULL OR r.site_id = $2) ORDER BY r.created_at`,
      [ctx.orgId, optUuid(ctx.url, "siteId")],
    )
    return { rules: r.rows, kinds: RULE_LABELS }
  }),
)

export const POST = api({ perm: "rules.write" }, async (ctx) =>
  ctx.tx(async (c) => ({
    ruleId: await createRule(c, ctx.orgId, ctx.actor, {
      kind: oneOf(ctx.body, "kind", "Вид правила", RULE_KINDS),
      name: str(ctx.body, "name", "Название", { max: 120 }),
      siteId: uuid(ctx.body, "siteId", "Объект"),
      meterId: uuid(ctx.body, "meterId", "Прибор"),
      channelId: num(ctx.body, "channelId", "Канал", { integer: true, min: 1 }),
      params: ctx.body.params,
      severity: str(ctx.body, "severity", "Важность", { max: 10 }) ?? undefined,
      notify: bool(ctx.body, "notify", true),
      repeatMinutes: num(ctx.body, "repeatMinutes", "Повторять не чаще, мин", { min: 15, max: 10080, integer: true }),
      windowFrom: num(ctx.body, "windowFrom", "Окно с", { min: 0, max: 23, integer: true }),
      windowTo: num(ctx.body, "windowTo", "Окно до", { min: 0, max: 24, integer: true }),
    }),
  })),
)
