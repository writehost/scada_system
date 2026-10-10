import { api } from "@/lib/server/http.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "org.manage" }, async (ctx) =>
  ctx.tx(async (c) => {
    const before = Number(ctx.url.searchParams.get("before") || 0)
    const r = await c.query(
      `SELECT a.audit_id, a.actor_kind, a.action, a.entity_type, a.entity_id, a.details, a.ip, a.created_at, u.display_name AS actor_name
         FROM ems_audit_log a LEFT JOIN ems_users u ON u.user_id = a.actor_id
        WHERE a.org_id = $1 AND ($2 = 0 OR a.audit_id < $2) ORDER BY a.audit_id DESC LIMIT 100`,
      [ctx.orgId, before],
    )
    return { items: r.rows }
  }),
)
