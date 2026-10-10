import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { conflict, notFound } from "@/lib/server/errors.ts"
import { str } from "@/lib/server/validate.ts"
import { audit } from "@/lib/services/audit.ts"
import { assertWritable } from "@/lib/services/subscription.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const PATCH = api({ perm: "sites.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    await assertWritable(c, ctx.orgId)
    const r = await c.query("UPDATE ems_nodes SET name = COALESCE($3, name), code = COALESCE($4, code) WHERE node_id = $1 AND org_id = $2 RETURNING node_id", [id, ctx.orgId, str(ctx.body, "name", "Название", { max: 120 }), str(ctx.body, "code", "Код", { max: 40 })])
    if (!r.rows[0]) throw notFound("Узел")
    await audit(c, ctx.orgId, ctx.actor, "node.update", { type: "node", id })
    return { ok: true }
  }),
)

export const DELETE = api({ perm: "sites.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const used = await c.query(
      `WITH RECURSIVE tree AS (SELECT node_id FROM ems_nodes WHERE node_id = $1 AND org_id = $2 UNION ALL SELECT n.node_id FROM ems_nodes n JOIN tree t ON n.parent_id = t.node_id)
       SELECT count(*)::int AS n FROM ems_meters WHERE node_id IN (SELECT node_id FROM tree) AND status = 'active'`,
      [id, ctx.orgId],
    )
    if (used.rows[0].n > 0) throw conflict("В узле есть действующие приборы. Перенесите их или выведите из эксплуатации.")
    const r = await c.query(
      `WITH RECURSIVE tree AS (SELECT node_id FROM ems_nodes WHERE node_id = $1 AND org_id = $2 UNION ALL SELECT n.node_id FROM ems_nodes n JOIN tree t ON n.parent_id = t.node_id)
       UPDATE ems_nodes SET archived_at = now() WHERE node_id IN (SELECT node_id FROM tree) AND archived_at IS NULL RETURNING node_id`,
      [id, ctx.orgId],
    )
    if (!r.rows[0]) throw notFound("Узел")
    await audit(c, ctx.orgId, ctx.actor, "node.archive", { type: "node", id })
    return { ok: true }
  }),
)
