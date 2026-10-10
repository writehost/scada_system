import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { conflict, notFound } from "@/lib/server/errors.ts"
import { reqStr } from "@/lib/server/validate.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const g = (await c.query("SELECT g.*, s.name AS site_name FROM ems_gateways g JOIN ems_sites s ON s.site_id = g.site_id WHERE g.gateway_id = $1 AND g.org_id = $2", [id, ctx.orgId])).rows[0]
    if (!g) throw notFound("Шлюз")
    delete g.secret_hash
    const log = await c.query(
      "SELECT l.log_id, l.level, l.code, l.message, l.created_at, m.name AS meter_name FROM ems_connection_log l LEFT JOIN ems_meters m ON m.meter_id = l.meter_id WHERE l.gateway_id = $1 ORDER BY l.created_at DESC LIMIT 200",
      [id],
    )
    const meters = await c.query("SELECT meter_id, name, connection_params, poll_interval_sec, status FROM ems_meters WHERE gateway_id = $1 ORDER BY name", [id])
    const jobs = await c.query("SELECT job_id, kind, status, error, created_at, finished_at FROM ems_gateway_jobs WHERE gateway_id = $1 ORDER BY created_at DESC LIMIT 20", [id])
    return { gateway: g, log: log.rows, meters: meters.rows, jobs: jobs.rows }
  }),
)

export const DELETE = api({ perm: "devices.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const g = (await c.query("SELECT name FROM ems_gateways WHERE gateway_id = $1 AND org_id = $2 AND archived_at IS NULL", [id, ctx.orgId])).rows[0]
    if (!g) throw notFound("Шлюз")
    if (reqStr({ confirm: ctx.url.searchParams.get("confirm") ?? "" }, "confirm", "Подтверждение") !== g.name) throw conflict("Введите название шлюза для подтверждения", "confirmation_required")
    const used = await c.query("SELECT count(*)::int AS n FROM ems_meters WHERE gateway_id = $1 AND status = 'active'", [id])
    if (used.rows[0].n > 0) throw conflict("К шлюзу подключены действующие приборы: перенесите их на другой шлюз или выведите из эксплуатации")
    await c.query("UPDATE ems_gateways SET archived_at = now(), secret_hash = NULL, status = 'disabled' WHERE gateway_id = $1", [id])
    await audit(c, ctx.orgId, ctx.actor, "gateway.archive", { type: "gateway", id }, { name: g.name })
    return { ok: true }
  }),
)
