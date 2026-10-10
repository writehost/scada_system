import { api } from "@/lib/server/http.ts"
import { intParam, timeParam } from "@/lib/server/params.ts"
import { badRequest, notFound } from "@/lib/server/errors.ts"
import { ingestReadings } from "@/lib/services/ingest.ts"
import { assertWritable } from "@/lib/services/subscription.ts"
import { audit } from "@/lib/services/audit.ts"
import { rawReadings } from "@/lib/services/analytics.ts"
import { FLAG_LABELS } from "@/lib/domain/readings.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const channelId = intParam(ctx.url.searchParams.get("channelId"), "Канал")
    const ch = (await c.query(
      `SELECT ch.channel_id, ch.name, ch.unit, ch.measure_kind, ch.decimals, m.name AS meter_name, m.meter_id FROM ems_channels ch JOIN ems_meters m ON m.meter_id = ch.meter_id WHERE ch.channel_id = $1 AND ch.org_id = $2`,
      [channelId, ctx.orgId],
    )).rows[0]
    if (!ch) throw notFound("Канал")
    const to = timeParam(ctx.url, "to", Date.now() + 60_000)
    const from = timeParam(ctx.url, "from", to - 400 * 86400000)
    return { channel: ch, readings: await rawReadings(c, channelId, from, to, Number(ctx.url.searchParams.get("limit") || 200)), flagLabels: FLAG_LABELS }
  }),
)

/** Ручной ввод показаний (одно или несколько каналов за раз). */
export const POST = api({ perm: "readings.write", tokenScope: "readings:write" }, async (ctx) =>
  ctx.tx(async (c) => {
    await assertWritable(c, ctx.orgId)
    const items = ctx.body.items
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw badRequest("Передайте от 1 до 100 показаний")
    const parsed = items.map((x, i) => {
      const o = (x ?? {}) as Record<string, unknown>
      const channelId = Number(o.channelId)
      if (!Number.isInteger(channelId) || channelId <= 0) throw badRequest(`Показание ${i + 1}: укажите канал`)
      const raw = typeof o.value === "string" ? Number(o.value.replace(/\s/g, "").replace(",", ".")) : Number(o.value)
      if (!Number.isFinite(raw)) throw badRequest(`Показание ${i + 1}: введите число`)
      const at = o.at == null || o.at === "" ? Date.now() : typeof o.at === "number" ? o.at : Date.parse(String(o.at))
      if (!Number.isFinite(at)) throw badRequest(`Показание ${i + 1}: неверная дата`)
      return { channelId, at, raw, source: "manual" as const, enteredBy: ctx.user?.userId ?? null, note: typeof o.note === "string" ? o.note.slice(0, 300) : null }
    })
    const results = await ingestReadings(c, ctx.orgId, parsed)
    await audit(c, ctx.orgId, ctx.actor, "readings.manual", undefined, { count: parsed.length, accepted: results.filter((r) => r.status === "accepted").length })
    return {
      results: results.map((r) => ({ ...r, flagLabels: (r.flags ?? []).map((f) => FLAG_LABELS[f as keyof typeof FLAG_LABELS] ?? f) })),
    }
  }),
)
