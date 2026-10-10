import { publicApi } from "@/lib/server/http.ts"
import { withOrg } from "@/lib/server/db.ts"
import { gatewayFrom } from "@/lib/server/gateway-auth.ts"
import { gatewayConfig } from "@/lib/services/gateways.ts"
import { getSubscription } from "@/lib/services/subscription.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = publicApi({}, async ({ req }) => {
  const gw = await gatewayFrom(req)
  return withOrg(gw.orgId, async (c) => gatewayConfig(c, gw, (await getSubscription(c, gw.orgId)).limits.min_poll_sec))
})
