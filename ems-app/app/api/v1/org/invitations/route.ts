import { api } from "@/lib/server/http.ts"
import { email, oneOf } from "@/lib/server/validate.ts"
import { assertLimit } from "@/lib/services/subscription.ts"
import { audit } from "@/lib/services/audit.ts"
import { enqueueDirect, publicUrl } from "@/lib/services/notify.ts"
import { conflict } from "@/lib/server/errors.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "users.manage" }, async (ctx) =>
  ctx.tx(async (c) => {
    const addr = email(ctx.body, "email")!
    const role = oneOf(ctx.body, "role", "Роль", ["admin", "engineer", "accountant", "viewer"] as const)
    await assertLimit(c, ctx.orgId, "users")
    const member = await c.query("SELECT 1 FROM ems_memberships m JOIN ems_users u ON u.user_id = m.user_id WHERE m.org_id = $1 AND lower(u.email) = $2", [ctx.orgId, addr])
    if (member.rows[0]) throw conflict("Пользователь уже в организации")
    const r = await c.query(
      "INSERT INTO ems_invitations (org_id, email, role, created_by, expires_at) VALUES ($1, $2, $3, $4, now() + interval '14 days') RETURNING invitation_id",
      [ctx.orgId, addr, role, ctx.user?.userId ?? null],
    )
    const org = (await c.query("SELECT name FROM ems_organizations WHERE org_id = $1", [ctx.orgId])).rows[0]
    await enqueueDirect(c, {
      orgId: ctx.orgId,
      email: addr,
      kind: "invite",
      subject: `Приглашение в SCADA EMS: ${org.name}`,
      lead: `${ctx.user?.displayName ?? "Администратор"} приглашает вас в «${org.name}». Войдите через SCADA ID с этим адресом почты — доступ откроется автоматически.`,
      link: `${publicUrl()}/login`,
      ctaLabel: "Войти через SCADA ID",
      reason: "приглашение в организацию",
      dedupKey: `invite:${r.rows[0].invitation_id}`,
    })
    await audit(c, ctx.orgId, ctx.actor, "member.invite", { type: "invitation", id: r.rows[0].invitation_id }, { email: addr, role })
    return { invitationId: r.rows[0].invitation_id }
  }),
)
