import { actorCan } from "@/lib/route/auth"
import { eventsSince, lastEventId, routeBus, type RouteEvent } from "@/lib/route/events"
import { withRoute } from "@/lib/route/http"
import { currentSession } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SITE_WIDE = new Set(["route.blocked", "route.unblocked", "map.published"])

/**
 * Поток событий (Server-Sent Events). Last-Event-ID / ?since= — дочитка пропущенного из журнала.
 * Водитель получает события своего погрузчика и общие; диспетчер — все.
 */
export async function GET(req: Request) {
  return withRoute(req, "route.read", async (ctx) => {
    const pool = ctx.pool
    const siteId = ctx.siteId
    const isDispatcher = actorCan(ctx.actor, "route.dispatch") || actorCan(ctx.actor, "route.map.write")
    const session = ctx.actor.kind === "user" ? await currentSession(ctx.client, siteId, ctx.actor.login) : null
    const karaFilter = isDispatcher ? null : session?.karaId ?? "__none__"
    const header = req.headers.get("last-event-id") || ctx.url.searchParams.get("since") || ""
    let cursor = /^\d+$/.test(header) ? Number(header) : await lastEventId(ctx.client, siteId)
    const bus = routeBus()
    await bus.ensure()
    const enc = new TextEncoder()
    let closed = false
    let timer: ReturnType<typeof setInterval> | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let onKick: ((id: number) => void) | null = null
    let onPos: ((data: Record<string, unknown>) => void) | null = null
    const stop = () => {
      closed = true
      if (timer) clearInterval(timer)
      if (poll) clearInterval(poll)
      if (onKick) bus.off(`site:${siteId}`, onKick)
      if (onPos) bus.off(`pos:${siteId}`, onPos)
    }

    const visible = (e: RouteEvent) => karaFilter == null || SITE_WIDE.has(e.topic) || e.karaId === karaFilter || (e.payload?.prevKaraId as string | undefined) === karaFilter

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (text: string) => {
          if (!closed) controller.enqueue(enc.encode(text))
        }
        let draining = false
        const drain = async () => {
          if (draining || closed) return
          draining = true
          const c = await pool.connect()
          try {
            for (;;) {
              const batch = await eventsSince(c, siteId, cursor, 200)
              for (const e of batch) {
                cursor = e.id
                if (visible(e)) send(`id: ${e.id}\nevent: ${e.topic}\ndata: ${JSON.stringify(e)}\n\n`)
              }
              if (batch.length < 200) break
            }
          } catch {
            /* следующая попытка по таймеру */
          } finally {
            c.release()
            draining = false
          }
        }
        send(`retry: 2000\n: connected ${new Date().toISOString()}\n\n`)
        onKick = (id: number) => void drain()
        bus.on(`site:${siteId}`, onKick)
        onPos = (data: Record<string, unknown>) => {
          if (karaFilter == null || data.karaId === karaFilter) send(`event: forklift.position.updated\ndata: ${JSON.stringify(data)}\n\n`)
        }
        bus.on(`pos:${siteId}`, onPos)
        void drain()
        timer = setInterval(() => send(`: ping\n\n`), 15000)
        poll = setInterval(() => void drain(), 3000)
      },
      cancel() {
        stop()
      },
    })
    req.signal.addEventListener("abort", stop)
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    })
  })
}
