import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { conflict, notFound } from "@/lib/server/errors.ts"
import { str } from "@/lib/server/validate.ts"
import { validateShifts } from "@/lib/services/assets.ts"
import { assertWritable } from "@/lib/services/subscription.ts"
import { audit } from "@/lib/services/audit.ts"
import { isValidTimeZone } from "@/lib/domain/time.ts"
import { badRequest } from "@/lib/server/errors.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const site = (await c.query("SELECT site_id, name, kind, address, timezone, shifts, created_at FROM ems_sites WHERE site_id = $1 AND org_id = $2 AND archived_at IS NULL", [id, ctx.orgId])).rows[0]
    if (!site) throw notFound("Объект")
    const nodes = await c.query("SELECT node_id, parent_id, kind, name, code, sort FROM ems_nodes WHERE site_id = $1 AND archived_at IS NULL ORDER BY sort, name", [id])
    return { site, nodes: nodes.rows }
  }),
)

export const PATCH = api({ perm: "sites.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    await assertWritable(c, ctx.orgId)
    const tz = str(ctx.body, "timezone", "Часовой пояс", { max: 60 })
    if (tz && !isValidTimeZone(tz)) throw badRequest("Неизвестный часовой пояс")
    const r = await c.query(
      `UPDATE ems_sites SET name = COALESCE($3, name), address = COALESCE($4, address), timezone = COALESCE($5, timezone), shifts = COALESCE($6::jsonb, shifts)
        WHERE site_id = $1 AND org_id = $2 AND archived_at IS NULL RETURNING site_id`,
      [id, ctx.orgId, str(ctx.body, "name", "Название", { max: 120 }), str(ctx.body, "address", "Адрес", { max: 300 }), tz, ctx.body.shifts !== undefined ? JSON.stringify(validateShifts(ctx.body.shifts)) : null],
    )
    if (!r.rows[0]) throw notFound("Объект")
    await audit(c, ctx.orgId, ctx.actor, "site.update", { type: "site", id })
    return { ok: true }
  }),
)

/** Архивирование, а не удаление: история измерений сохраняется. */
export const DELETE = api({ perm: "sites.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const confirm = ctx.url.searchParams.get("confirm")
    const site = (await c.query("SELECT name FROM ems_sites WHERE site_id = $1 AND org_id = $2 AND archived_at IS NULL", [id, ctx.orgId])).rows[0]
    if (!site) throw notFound("Объект")
    if (confirm !== site.name) throw conflict("Для архивации введите точное название объекта", "confirmation_required")
    await c.query("UPDATE ems_sites SET archived_at = now() WHERE site_id = $1", [id])
    await c.query("UPDATE ems_meters SET status = 'archived', removed_at = COALESCE(removed_at, now()) WHERE site_id = $1 AND status = 'active'", [id])
    await audit(c, ctx.orgId, ctx.actor, "site.archive", { type: "site", id }, { name: site.name })
    return { ok: true }
  }),
)
