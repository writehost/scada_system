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
      `UPDATE ems_events SET status = 'resolved', resolved_at = now(), ack_note = COALESCE($4, ack_note), acknowledged_by = COALESCE(acknowledged_by, $3) WHERE event_id = $1 AND org_id = $2 AND status <> 'resolved' RETURNING event_id`,
      [id, ctx.orgId, ctx.user?.userId ?? null, note],
    )
    if (!r.rows[0]) throw conflict("Событие уже обработано или не найдено")
    await audit(c, ctx.orgId, ctx.actor, "event.resolve", { type: "event", id }, { note })
    return { ok: true }
  }),
)
