import { api } from "@/lib/server/http.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const members = await c.query(
      `SELECT m.user_id, u.display_name, u.email, m.role, m.source, m.created_at FROM ems_memberships m JOIN ems_users u ON u.user_id = m.user_id WHERE m.org_id = $1 ORDER BY m.created_at`,
      [ctx.orgId],
    )
    const invitations = await c.query(
      `SELECT invitation_id, email, role, created_at, expires_at FROM ems_invitations WHERE org_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at`,
      [ctx.orgId],
    )
    return { members: members.rows, invitations: invitations.rows, me: ctx.user?.userId }
  }),
)
