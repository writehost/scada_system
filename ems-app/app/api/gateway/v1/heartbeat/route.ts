import { publicApi } from "@/lib/server/http.ts"
import { withOrg } from "@/lib/server/db.ts"
import { gatewayFrom } from "@/lib/server/gateway-auth.ts"
import { gatewayConfig } from "@/lib/services/gateways.ts"
import { getSubscription } from "@/lib/services/subscription.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = publicApi({ maxBody: 200_000 }, async ({ req, body }) => {
  const gw = await gatewayFrom(req)
  const diag = {
    bufferItems: Number(body.bufferItems ?? 0) || 0,
    bufferBytes: Number(body.bufferBytes ?? 0) || 0,
    bufferLimitBytes: Number(body.bufferLimitBytes ?? 0) || 0,
    droppedItems: Number(body.droppedItems ?? 0) || 0,
    uptimeSec: Number(body.uptimeSec ?? 0) || 0,
    lastUploadAt: typeof body.lastUploadAt === "string" ? body.lastUploadAt : null,
    meters: Array.isArray(body.meters) ? body.meters.slice(0, 500) : [],
    os: typeof body.os === "string" ? body.os.slice(0, 120) : null,
    receivedAt: new Date().toISOString(),
  }
  return withOrg(gw.orgId, async (c) => {
    await c.query("UPDATE ems_gateways SET diagnostics = $2::jsonb, agent_version = COALESCE($3, agent_version), last_seen_at = now(), status = 'online' WHERE gateway_id = $1", [gw.gatewayId, JSON.stringify(diag), typeof body.agentVersion === "string" ? body.agentVersion.slice(0, 40) : null])
    const cfg = await gatewayConfig(c, gw, (await getSubscription(c, gw.orgId)).limits.min_poll_sec)
    return { ok: true, configVersion: cfg.version, serverTime: cfg.serverTime }
  })
})
