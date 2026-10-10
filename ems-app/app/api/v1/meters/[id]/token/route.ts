import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { createMeterToken } from "@/lib/services/tokens.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "devices.write" }, async (ctx, p) => ctx.tx((c) => createMeterToken(c, ctx.orgId, ctx.actor, idParam(p.id))))
