// Пакет показаний от шлюза. Шлюз удаляет данные из локального буфера только
// после ответа 200; повторная отправка того же пакета безопасна.
import { publicApi } from "@/lib/server/http.ts"
import { withOrg } from "@/lib/server/db.ts"
import { badRequest } from "@/lib/server/errors.ts"
import { gatewayFrom } from "@/lib/server/gateway-auth.ts"
import { ingestReadings } from "@/lib/services/ingest.ts"
import { assertIngest } from "@/lib/services/subscription.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = publicApi({ maxBody: 2_000_000 }, async ({ req, body }) => {
  const gw = await gatewayFrom(req)
  const list = body.readings
  if (!Array.isArray(list) || list.length > 5000) throw badRequest("readings: массив до 5000 элементов")
  const items = list.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>
    const channelId = Number(o.channelId)
    const at = typeof o.at === "number" ? o.at : Date.parse(String(o.at))
    const raw = Number(o.raw)
    if (!Number.isInteger(channelId) || !Number.isFinite(at)) throw badRequest(`readings[${i}]: channelId и at обязательны`)
    return { channelId, at, raw, source: "gateway" as const }
  })
  return withOrg(gw.orgId, async (c) => {
    await assertIngest(c, gw.orgId)
    // Шлюз пишет только в каналы своих приборов.
    const own = await c.query<{ channel_id: number }>(
      `SELECT ch.channel_id FROM ems_channels ch JOIN ems_meters m ON m.meter_id = ch.meter_id WHERE m.gateway_id = $1 AND ch.channel_id = ANY($2::bigint[])`,
      [gw.gatewayId, [...new Set(items.map((i) => i.channelId))]],
    )
    const allowed = new Set(own.rows.map((r) => r.channel_id))
    const accepted = items.filter((i) => allowed.has(i.channelId))
    const results = accepted.length ? await ingestReadings(c, gw.orgId, accepted) : []
    const count = (s: string) => results.filter((r) => r.status === s).length
    return {
      batchId: typeof body.batchId === "string" ? body.batchId.slice(0, 80) : null,
      received: items.length,
      accepted: count("accepted"),
      duplicates: count("duplicate"),
      conflicts: count("conflict"),
      rejected: results.filter((r) => r.status === "rejected").map((r) => ({ channelId: r.channelId, at: r.measuredAt, reason: r.reason })).concat(items.filter((i) => !allowed.has(i.channelId)).map((i) => ({ channelId: i.channelId, at: new Date(i.at).toISOString(), reason: "channel_not_on_gateway" }))),
      suspect: results.filter((r) => r.quality && r.quality !== "good").length,
    }
  })
})
