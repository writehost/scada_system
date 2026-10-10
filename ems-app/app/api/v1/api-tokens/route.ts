import { api } from "@/lib/server/http.ts"
import { reqStr } from "@/lib/server/validate.ts"
import { createApiToken } from "@/lib/services/tokens.ts"
import { badRequest } from "@/lib/server/errors.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "integrations.manage" }, async (ctx) =>
  ctx.tx(async (c) => ({
    tokens: (await c.query("SELECT token_id, name, prefix, scopes, created_at, last_used_at FROM ems_api_tokens WHERE org_id = $1 AND revoked_at IS NULL ORDER BY created_at", [ctx.orgId])).rows,
  })),
)

export const POST = api({ perm: "integrations.manage", rate: 20 }, async (ctx) =>
  ctx.tx(async (c) => {
    if (!Array.isArray(ctx.body.scopes)) throw badRequest("Выберите разрешения")
    return createApiToken(c, ctx.orgId, ctx.actor, { name: reqStr(ctx.body, "name", "Название", 80), scopes: ctx.body.scopes.map(String) })
  }),
)
