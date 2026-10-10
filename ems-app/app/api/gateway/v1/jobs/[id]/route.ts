import { publicApi } from "@/lib/server/http.ts"
import { withOrg } from "@/lib/server/db.ts"
import { gatewayFrom } from "@/lib/server/gateway-auth.ts"
import { completeJob } from "@/lib/services/gateways.ts"
import { idParam } from "@/lib/server/params.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = publicApi({ maxBody: 200_000 }, async ({ req, body }, p) => {
  const gw = await gatewayFrom(req)
  const id = idParam(p.id)
  await withOrg(gw.orgId, (c) => completeJob(c, gw, id, { ok: body.ok === true, result: body.result, error: typeof body.error === "string" ? body.error : null }))
  return { ok: true }
})
