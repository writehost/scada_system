import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { notFound, badRequest } from "@/lib/server/errors.ts"
import { bool, num, str, timestamp } from "@/lib/server/validate.ts"
import { updateRecipient } from "@/lib/services/recipients.ts"
import { audit } from "@/lib/services/audit.ts"
import { isUuid } from "@/lib/server/db.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const PATCH = api({ perm: "notifications.manage" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const siteIds = ctx.body.siteIds
    if (siteIds != null && (!Array.isArray(siteIds) || !siteIds.every(isUuid))) throw badRequest("Объекты: список идентификаторов")
    const paused = "pausedUntil" in ctx.body ? timestamp(ctx.body, "pausedUntil", "Пауза до") : undefined
    await updateRecipient(c, ctx.orgId, ctx.actor, idParam(p.id), {
      label: "label" in ctx.body ? str(ctx.body, "label", "Подпись", { max: 80 }) : undefined,
      kinds: ctx.body.kinds,
      siteIds: "siteIds" in ctx.body ? ((siteIds as string[] | null) ?? null) : undefined,
      enabled: "enabled" in ctx.body ? bool(ctx.body, "enabled") : undefined,
      pausedUntil: paused === undefined ? undefined : paused == null ? null : new Date(paused).toISOString(),
      sendHour: num(ctx.body, "sendHour", "Час отправки", { min: 0, max: 23, integer: true }),
    })
    return { ok: true }
  }),
)

export const DELETE = api({ perm: "notifications.manage" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const r = await c.query("DELETE FROM ems_email_recipients WHERE recipient_id = $1 AND org_id = $2 RETURNING email", [id, ctx.orgId])
    if (!r.rows[0]) throw notFound("Адрес")
    await c.query("UPDATE ems_obligations SET recipient_ids = array_remove(recipient_ids, $1::uuid) WHERE org_id = $2", [id, ctx.orgId])
    await audit(c, ctx.orgId, ctx.actor, "recipient.delete", { type: "recipient", id }, r.rows[0])
    return { ok: true }
  }),
)
