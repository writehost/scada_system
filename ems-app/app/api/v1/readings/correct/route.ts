import { api } from "@/lib/server/http.ts"
import { notFound } from "@/lib/server/errors.ts"
import { num, oneOf, reqStr, timestamp } from "@/lib/server/validate.ts"
import { correctReading } from "@/lib/services/ingest.ts"
import { assertWritable } from "@/lib/services/subscription.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "readings.correct" }, async (ctx) =>
  ctx.tx(async (c) => {
    await assertWritable(c, ctx.orgId)
    const channelId = num(ctx.body, "channelId", "Канал", { required: true, integer: true, min: 1 })!
    const at = timestamp(ctx.body, "measuredAt", "Время показания", true)!
    const action = oneOf(ctx.body, "action", "Действие", ["reject", "confirm", "edit"] as const)
    const newRaw = action === "edit" ? num(ctx.body, "value", "Новое значение", { required: true, min: 0 })! : undefined
    const reason = reqStr(ctx.body, "reason", "Причина исправления", 300)
    try {
      const r = await correctReading(c, ctx.orgId, channelId, at, action, { newRaw, reason, actorId: ctx.user?.userId ?? "" })
      await audit(c, ctx.orgId, ctx.actor, `reading.${action}`, { type: "channel", id: channelId }, { measuredAt: new Date(at).toISOString(), reason })
      return r
    } catch (e) {
      if ((e as Error).message === "not_found") throw notFound("Показание")
      throw e
    }
  }),
)
