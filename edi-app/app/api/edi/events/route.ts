import { route } from "@/lib/http.ts"
import { subscribe } from "@/lib/edi/events.ts"
import { withClient } from "@/lib/db.ts"
import { getDocument } from "@/lib/edi/documents.ts"
import { actorFromSession } from "@/lib/edi/actor.ts"
import { currentOidcRoles } from "@/lib/auth/oidc-sessions.ts"
import { publicOrigin } from "@/lib/auth/origin.ts"
import { permissionsForRoles } from "@/lib/edi/permissions.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ actor, req, session }) => {
  const enc = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let ping: ReturnType<typeof setInterval> | null = null
  let expiry: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
  const close = () => {
    if (closed) return
    closed = true
    unsubscribe?.()
    if (ping) clearInterval(ping)
    if (expiry) clearTimeout(expiry)
    req.signal.removeEventListener("abort", close)
    try { controllerRef?.close() } catch { /* stream already closed */ }
  }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller
      req.signal.addEventListener("abort", close, { once: true })
      if (req.signal.aborted) { close(); return }
      const send = (data: unknown) => {
        if (closed) return
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch { close() }
      }
      send({ kind: "hello" })
      try {
        unsubscribe = await subscribe((event) => {
          if (closed || event.siteId !== actor.siteId || (event.userId && event.userId !== actor.userId)) return
          void withClient(async (client) => {
            const current = await actorFromSession(client, session)
            if (session.via === "scada-id") {
              current.roles = await currentOidcRoles(client, session, publicOrigin(req))
              current.permissions = permissionsForRoles(current.roles)
            }
            if (event.documentId) await getDocument(client, current, event.documentId)
            send({ kind: event.kind, documentId: event.documentId ?? null })
          }).catch(() => undefined)
        })
        if (closed) { unsubscribe(); return }
        ping = setInterval(() => { if (!closed) { try { controller.enqueue(enc.encode(": ping\n\n")) } catch { close() } } }, 25_000)
        // Browser reconnect performs a fresh session and authority check.
        expiry = setTimeout(close, Math.max(1, Math.min(60_000, session.exp - Date.now())))
      } catch { close() }
    },
    cancel: close,
  })
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no",
  } })
})
