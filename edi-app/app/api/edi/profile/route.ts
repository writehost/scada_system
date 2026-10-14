import { HttpError } from "@/lib/db.ts"
import { jsonBody, route } from "@/lib/http.ts"
import { mailConfigured } from "@/lib/edi/mailer.ts"
import { channelsFor, NOTIFY_EVENTS, type Channel } from "@/lib/edi/notify.ts"
import { resolveIntegration } from "@/lib/edi/integrations/config.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor }) => {
  const r = await client.query<{ prefs: Record<string, unknown>; email: string | null; department: string | null }>(
    `SELECT prefs, email, department FROM edi_user_profiles WHERE site_id = $1 AND user_id = $2::bigint`,
    [actor.siteId, actor.userId]
  )
  const p = r.rows[0]
  const wms = await resolveIntegration(client, actor.siteId, "wms")
  const channels: Array<{ code: Channel; label: string; available: boolean }> = [
    { code: "inapp", label: "В SCADA EDI", available: true },
    { code: "wms", label: "Уведомления SCADA (WMS, SCADA Mobile)", available: Boolean(wms?.enabled) },
    { code: "email", label: "Email", available: mailConfigured() && Boolean(p?.email) },
  ]
  return {
    email: p?.email ?? null,
    department: p?.department ?? null,
    channels,
    events: Object.entries(NOTIFY_EVENTS).map(([code, label]) => ({ code, label, channels: channelsFor(code, p?.prefs) })),
  }
})

export const POST = route(async ({ client, actor, req }) => {
  const b = await jsonBody<{ email?: string | null; department?: string | null; notifications?: Record<string, Channel[]> }>(req)
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) throw new HttpError(400, "Некорректный email", "bad_email")
  const notif: Record<string, Channel[]> = {}
  for (const [k, v] of Object.entries(b.notifications ?? {})) {
    if (NOTIFY_EVENTS[k] && Array.isArray(v)) notif[k] = v.filter((c) => ["inapp", "email", "wms"].includes(c))
  }
  await client.query(
    `INSERT INTO edi_user_profiles (site_id, user_id, email, department, prefs) VALUES ($1, $2::bigint, $3, $4, jsonb_build_object('notifications', $5::jsonb))
     ON CONFLICT (site_id, user_id) DO UPDATE SET
       email = COALESCE($3, edi_user_profiles.email), department = COALESCE($4, edi_user_profiles.department),
       prefs = edi_user_profiles.prefs || jsonb_build_object('notifications', $5::jsonb), updated_at = now()`,
    [actor.siteId, actor.userId, b.email?.trim() || null, b.department?.trim() || null, JSON.stringify(notif)]
  )
  return { ok: true }
})
