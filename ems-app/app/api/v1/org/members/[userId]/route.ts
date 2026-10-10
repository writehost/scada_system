import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { conflict, forbidden, notFound } from "@/lib/server/errors.ts"
import { oneOf } from "@/lib/server/validate.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function owners(c: { query: Function }, orgId: string): Promise<number> {
  return (await (c as any).query("SELECT count(*)::int AS n FROM ems_memberships WHERE org_id = $1 AND role = 'owner'", [orgId])).rows[0].n
}

export const PATCH = api({ perm: "users.manage" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const userId = idParam(p.userId)
    const role = oneOf(ctx.body, "role", "Роль", ["owner", "admin", "engineer", "accountant", "viewer"] as const)
    const cur = (await c.query("SELECT role, source FROM ems_memberships WHERE org_id = $1 AND user_id = $2", [ctx.orgId, userId])).rows[0]
    if (!cur) throw notFound("Пользователь")
    if (cur.source === "scada_id") throw conflict("Роль этого пользователя задаётся в SCADA ID")
    if ((role === "owner" || cur.role === "owner") && ctx.role !== "owner") throw forbidden("Назначать владельца может только владелец")
    if (cur.role === "owner" && role !== "owner" && (await owners(c, ctx.orgId)) <= 1) throw conflict("Нельзя снять единственного владельца")
    await c.query("UPDATE ems_memberships SET role = $3 WHERE org_id = $1 AND user_id = $2", [ctx.orgId, userId, role])
    await audit(c, ctx.orgId, ctx.actor, "member.role", { type: "user", id: userId }, { from: cur.role, to: role })
    return { ok: true }
  }),
)

export const DELETE = api({ perm: "users.manage" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const userId = idParam(p.userId)
    const cur = (await c.query("SELECT role FROM ems_memberships WHERE org_id = $1 AND user_id = $2", [ctx.orgId, userId])).rows[0]
    if (!cur) throw notFound("Пользователь")
    if (cur.role === "owner" && (await owners(c, ctx.orgId)) <= 1) throw conflict("Нельзя удалить единственного владельца")
    await c.query("DELETE FROM ems_memberships WHERE org_id = $1 AND user_id = $2", [ctx.orgId, userId])
    await c.query("UPDATE ems_sessions SET active_org_id = NULL WHERE user_id = $1 AND active_org_id = $2", [userId, ctx.orgId])
    await audit(c, ctx.orgId, ctx.actor, "member.remove", { type: "user", id: userId })
    return { ok: true }
  }),
)
