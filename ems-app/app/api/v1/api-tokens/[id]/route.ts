import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { notFound } from "@/lib/server/errors.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const DELETE = api({ perm: "integrations.manage" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const r = await c.query("UPDATE ems_api_tokens SET revoked_at = now() WHERE token_id = $1 AND org_id = $2 AND revoked_at IS NULL RETURNING name", [id, ctx.orgId])
    if (!r.rows[0]) throw notFound("Токен")
    await audit(c, ctx.orgId, ctx.actor, "api_token.revoke", { type: "api_token", id })
    return { ok: true }
  }),
)
