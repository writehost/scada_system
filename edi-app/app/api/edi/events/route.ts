import { route } from "@/lib/http.ts"
import { subscribe } from "@/lib/edi/events.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Server-Sent Events: изменения документов и новые уведомления (только идентификаторы). */
export const GET = route(async ({ actor, req }) => {
  const enc = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let ping: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`))
      send({ kind: "hello" })
      unsubscribe = await subscribe((e) => {
        if (e.siteId !== actor.siteId) return
        if (e.userId && e.userId !== actor.userId) return
        send({ kind: e.kind, documentId: e.documentId ?? null })
      })
      ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 25_000)
      req.signal.addEventListener("abort", () => {
        unsubscribe?.()
        if (ping) clearInterval(ping)
        try {
          controller.close()
        } catch {
          /* уже закрыт */
        }
      })
    },
    cancel() {
      unsubscribe?.()
      if (ping) clearInterval(ping)
    },
  })
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  })
})
