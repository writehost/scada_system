import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { revokeGatewaySecret } from "@/lib/services/gateways.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "devices.write", rate: 20 }, async (ctx, p) => ctx.tx((c) => revokeGatewaySecret(c, ctx.orgId, ctx.actor, idParam(p.id))))
