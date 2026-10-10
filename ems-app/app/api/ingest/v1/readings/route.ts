// HTTP push от устройства с собственной прошивкой. Заголовок X-Device-Token: emsd_…
// Тело: { "readings": [ { "channel": "energy", "at": "2026-10-10T12:00:00Z", "value": 1234.5 } ] }
import { publicApi } from "@/lib/server/http.ts"
import { withOrg, withSystem } from "@/lib/server/db.ts"
import { badRequest, HttpError } from "@/lib/server/errors.ts"
import { rateLimit } from "@/lib/server/ratelimit.ts"
import { meterByToken } from "@/lib/services/tokens.ts"
import { ingestReadings } from "@/lib/services/ingest.ts"
import { assertIngest } from "@/lib/services/subscription.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = publicApi({ maxBody: 500_000 }, async ({ req, body }) => {
  const token = req.headers.get("x-device-token")?.trim() ?? ""
  const meter = await withSystem((c) => meterByToken(c, token))
  if (!meter) throw new HttpError(401, "device_auth_failed", "Неверный токен прибора")
  const rl = rateLimit(`dev:${meter.meterId}`, 120)
  if (!rl.ok) throw new HttpError(429, "rate_limited", "Слишком часто", { retryAfterSec: rl.retryAfterSec })
  if (!Array.isArray(body.readings) || body.readings.length === 0 || body.readings.length > 1000) throw badRequest("readings: от 1 до 1000 элементов")
  return withOrg(meter.orgId, async (c) => {
    await assertIngest(c, meter.orgId)
    const chans = await c.query<{ channel_id: number; code: string }>("SELECT channel_id, code FROM ems_channels WHERE meter_id = $1 AND archived_at IS NULL", [meter.meterId])
    const byCode = new Map(chans.rows.map((r) => [r.code, r.channel_id]))
    const items = (body.readings as unknown[]).map((x, i) => {
      const o = (x ?? {}) as Record<string, unknown>
      const channelId = byCode.get(String(o.channel ?? (chans.rows.length === 1 ? chans.rows[0].code : "")))
      if (!channelId) throw badRequest(`readings[${i}]: неизвестный канал ${String(o.channel ?? "")}`)
      const at = o.at == null ? Date.now() : typeof o.at === "number" ? o.at : Date.parse(String(o.at))
      return { channelId, at, raw: Number(o.value), source: "http_push" as const }
    })
    const results = await ingestReadings(c, meter.orgId, items)
    return { results: results.map((r) => ({ at: r.measuredAt, status: r.status, quality: r.quality, reason: r.reason })) }
  })
})
