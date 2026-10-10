// Выпуск продукции из MES/APS/WMS (опционально). Позволяет считать удельное потребление,
// например кВт·ч на 1000 бутылок. Повторная отправка того же периода обновляет запись.
import { api } from "@/lib/server/http.ts"
import { optUuid, timeParam } from "@/lib/server/params.ts"
import { badRequest, notFound } from "@/lib/server/errors.ts"
import { num, reqStr, str, timestamp, uuid } from "@/lib/server/validate.ts"
import { audit } from "@/lib/services/audit.ts"
import { getSubscription, hasFeature } from "@/lib/services/subscription.ts"
import { forbidden } from "@/lib/server/errors.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const to = timeParam(ctx.url, "to", Date.now())
    const from = timeParam(ctx.url, "from", to - 31 * 86400000)
    const r = await c.query(
      `SELECT p.production_id, p.site_id, p.node_id, n.name AS node_name, p.period_start, p.period_end, p.quantity, p.unit, p.source, p.external_ref
         FROM ems_production p LEFT JOIN ems_nodes n ON n.node_id = p.node_id
        WHERE p.org_id = $1 AND ($2::uuid IS NULL OR p.site_id = $2) AND p.period_start >= $3 AND p.period_end <= $4 ORDER BY p.period_start DESC LIMIT 500`,
      [ctx.orgId, optUuid(ctx.url, "siteId"), new Date(from), new Date(to)],
    )
    return { items: r.rows }
  }),
)

export const POST = api({ perm: "sites.write", tokenScope: "production:write" }, async (ctx) =>
  ctx.tx(async (c) => {
    const sub = await getSubscription(c, ctx.orgId)
    if (!hasFeature(sub, "production")) throw forbidden("Учёт выпуска продукции доступен в промышленных тарифах")
    const items = Array.isArray(ctx.body.items) ? ctx.body.items : [ctx.body]
    if (!items.length || items.length > 500) throw badRequest("Передайте от 1 до 500 записей")
    let saved = 0
    for (const raw of items) {
      const o = raw as Record<string, unknown>
      const siteId = uuid(o, "siteId", "Объект", true)!
      const nodeId = uuid(o, "nodeId", "Узел (линия)")
      const site = await c.query("SELECT 1 FROM ems_sites WHERE site_id = $1 AND org_id = $2", [siteId, ctx.orgId])
      if (!site.rows[0]) throw notFound("Объект")
      if (nodeId) {
        const n = await c.query("SELECT site_id FROM ems_nodes WHERE node_id = $1 AND org_id = $2", [nodeId, ctx.orgId])
        if (n.rows[0]?.site_id !== siteId) throw notFound("Узел")
      }
      const start = timestamp(o, "periodStart", "Начало периода", true)!
      const end = timestamp(o, "periodEnd", "Конец периода", true)!
      if (!(end > start)) throw badRequest("Конец периода позже начала")
      await c.query(
        `INSERT INTO ems_production (org_id, site_id, node_id, period_start, period_end, quantity, unit, source, external_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (org_id, site_id, COALESCE(node_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, source)
         DO UPDATE SET quantity = EXCLUDED.quantity, unit = EXCLUDED.unit, external_ref = EXCLUDED.external_ref`,
        [ctx.orgId, siteId, nodeId, new Date(start), new Date(end), num(o, "quantity", "Количество", { required: true, min: 0 }), reqStr(o, "unit", "Единица (шт, бут., т)", 20), str(o, "source", "Источник", { max: 40 }) ?? (ctx.via === "api_token" ? "api" : "manual"), str(o, "externalRef", "Внешний номер", { max: 80 })],
      )
      saved += 1
    }
    await audit(c, ctx.orgId, ctx.actor, "production.upsert", undefined, { count: saved })
    return { saved }
  }),
)
