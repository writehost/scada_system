import { EventEmitter } from "node:events"
import type { PoolClient } from "pg"
import { tryGetPool } from "../db.ts"
import { EDI_EVENTS_CHANNEL } from "./notify.ts"

/** Одно соединение LISTEN на процесс; SSE-клиенты подписываются на эмиттер. */
const bus = new EventEmitter()
bus.setMaxListeners(0)
let listener: PoolClient | null = null
let starting: Promise<void> | null = null

async function ensureListener() {
  if (listener || starting) return starting ?? undefined
  const pool = tryGetPool()
  if (!pool) return
  starting = (async () => {
    const c = await pool.connect()
    c.on("notification", (msg) => {
      if (msg.channel !== EDI_EVENTS_CHANNEL || !msg.payload) return
      try {
        bus.emit("event", JSON.parse(msg.payload))
      } catch {
        /* мусор в канале игнорируется */
      }
    })
    c.on("error", () => {
      listener = null
      c.release(true)
    })
    await c.query(`LISTEN ${EDI_EVENTS_CHANNEL}`)
    listener = c
  })().finally(() => {
    starting = null
  })
  return starting
}

export type BusEvent = { siteId: number; userId?: string; kind: string; documentId?: string | null }

export async function subscribe(fn: (e: BusEvent) => void): Promise<() => void> {
  await ensureListener()
  bus.on("event", fn)
  return () => bus.off("event", fn)
}
