// Long-poll заданий диагностики: шлюз держит запрос до wait секунд.
import { publicApi } from "@/lib/server/http.ts"
import { withOrg } from "@/lib/server/db.ts"
import { gatewayFrom } from "@/lib/server/gateway-auth.ts"
import { claimJob } from "@/lib/services/gateways.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = publicApi({}, async ({ req, url }) => {
  const gw = await gatewayFrom(req, 600)
  const wait = Math.min(Math.max(Number(url.searchParams.get("wait") || 0), 0), 25) * 1000
  const until = Date.now() + wait
  for (;;) {
    const job = await withOrg(gw.orgId, (c) => claimJob(c, gw))
    if (job || Date.now() >= until || req.signal.aborted) return { job }
    await new Promise((r) => setTimeout(r, 1000))
  }
})
