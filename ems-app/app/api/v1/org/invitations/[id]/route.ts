import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const DELETE = api({ perm: "users.manage" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    await c.query("UPDATE ems_invitations SET revoked_at = now() WHERE invitation_id = $1 AND org_id = $2", [id, ctx.orgId])
    await audit(c, ctx.orgId, ctx.actor, "member.invite_revoke", { type: "invitation", id })
    return { ok: true }
  }),
)
