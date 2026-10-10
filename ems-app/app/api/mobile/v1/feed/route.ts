// Лента уведомлений для мобильного клиента с курсором и long-poll (по образцу
// подписки ТСД WMS: клиент держит запрос, сервер отвечает при новом событии).
import { api } from "@/lib/server/http.ts"
import { withOrg } from "@/lib/server/db.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read", rate: 240 }, async (ctx) => {
  const after = Math.max(0, Number(ctx.url.searchParams.get("after") || 0) || 0)
  const wait = Math.min(Math.max(Number(ctx.url.searchParams.get("wait") || 0), 0), 25) * 1000
  const until = Date.now() + wait
  for (;;) {
    const items = await withOrg(ctx.orgId, async (c) =>
      (await c.query("SELECT seq, kind, severity, title, body, ref_type, ref_id, site_id, created_at FROM ems_feed WHERE org_id = $1 AND seq > $2 ORDER BY seq LIMIT 100", [ctx.orgId, after])).rows,
    )
    if (items.length || Date.now() >= until || ctx.req.signal.aborted) {
      return { items, cursor: items.length ? items[items.length - 1].seq : after }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
})
