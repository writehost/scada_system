import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { conflict } from "@/lib/server/errors.ts"
import { str } from "@/lib/server/validate.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "events.ack" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const note = str(ctx.body, "note", "Комментарий", { max: 500 })
    const r = await c.query(
      `UPDATE ems_events SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $3, ack_note = $4 WHERE event_id = $1 AND org_id = $2 AND status = 'open' RETURNING event_id`,
      [id, ctx.orgId, ctx.user?.userId ?? null, note],
    )
    if (!r.rows[0]) throw conflict("Событие уже обработано или не найдено")
    await audit(c, ctx.orgId, ctx.actor, "event.ack", { type: "event", id }, { note })
    return { ok: true }
  }),
)
