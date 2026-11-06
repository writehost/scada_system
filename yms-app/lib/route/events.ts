import { EventEmitter } from "node:events"
import { Client, type PoolClient } from "pg"

/**
 * События Route: запись в route_events (журнал/повтор после переподключения) + pg_notify.
 * NOTIFY доставляется только после COMMIT — клиент не увидит событие отменённой транзакции.
 */

export const ROUTE_TOPICS = [
  "task.assigned",
  "task.updated",
  "task.cancelled",
  "forklift.position.updated",
  "forklift.localization.lost",
  "route.blocked",
  "route.unblocked",
  "route.recalculated",
  "pallet.scan.accepted",
  "pallet.scan.rejected",
  "address.scan.accepted",
  "address.scan.rejected",
  "wms.movement.confirmed",
  "wms.movement.rejected",
  "map.published",
  "exception.created",
  "exception.resolved",
  "session.started",
  "session.ended",
  "forklift.mode.changed",
  "simulation.movement.done",
  "localizer.status",
] as const

export type RouteTopic = (typeof ROUTE_TOPICS)[number]

export type RouteEvent = {
  id: number
  siteId: number
  topic: RouteTopic
  karaId: string | null
  taskId: string | null
  payload: Record<string, unknown>
  at: string
}

export async function publish(
  client: PoolClient,
  siteId: number,
  topic: RouteTopic,
  opts: { karaId?: string | null; taskId?: string | number | null; payload?: Record<string, unknown> } = {}
): Promise<number> {
  const r = await client.query<{ event_id: string; created_at: string }>(
    `INSERT INTO route_events (site_id, topic, kara_id, task_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING event_id::text, created_at::text`,
    [siteId, topic, opts.karaId ?? null, opts.taskId != null ? Number(opts.taskId) : null, JSON.stringify(opts.payload ?? {})]
  )
  const id = Number(r.rows[0].event_id)
  await client.query(`SELECT pg_notify('route_events', $1)`, [JSON.stringify({ id, siteId })])
  return id
}

export async function eventsSince(
  client: PoolClient,
  siteId: number,
  sinceId: number,
  limit = 200
): Promise<RouteEvent[]> {
  const r = await client.query<{
    event_id: string
    topic: RouteTopic
    kara_id: string | null
    task_id: string | null
    payload: Record<string, unknown>
    created_at: string
  }>(
    `SELECT event_id::text, topic, kara_id, task_id::text, payload, created_at::text
     FROM route_events WHERE site_id = $1 AND event_id > $2 ORDER BY event_id LIMIT $3`,
    [siteId, sinceId, limit]
  )
  return r.rows.map((row) => ({
    id: Number(row.event_id),
    siteId,
    topic: row.topic,
    karaId: row.kara_id,
    taskId: row.task_id,
    payload: row.payload ?? {},
    at: row.created_at,
  }))
}

export async function lastEventId(client: PoolClient, siteId: number): Promise<number> {
  const r = await client.query<{ id: string | null }>(`SELECT max(event_id)::text AS id FROM route_events WHERE site_id = $1`, [
    siteId,
  ])
  return Number(r.rows[0]?.id || 0)
}

/** Один LISTEN-клиент на процесс. SSE-подписчики получают «пинок» и дочитывают журнал. */
class Bus extends EventEmitter {
  private client: Client | null = null
  private connecting: Promise<void> | null = null

  async ensure(): Promise<void> {
    if (this.client) return
    if (this.connecting) return this.connecting
    const url = (process.env.DATABASE_URL || process.env.PG_URL || "").trim()
    if (!url) return
    this.connecting = (async () => {
      const c = new Client({ connectionString: url })
      c.on("notification", (msg) => {
        try {
          const data = JSON.parse(msg.payload || "{}") as { id: number; siteId: number; pos?: Record<string, unknown> }
          if (data.pos) this.emit(`pos:${data.siteId}`, data.pos)
          else this.emit(`site:${data.siteId}`, data.id)
        } catch {
          /* мусор в канале игнорируем */
        }
      })
      c.on("error", () => {
        this.client = null
      })
      c.on("end", () => {
        this.client = null
      })
      await c.connect()
      await c.query("LISTEN route_events")
      this.client = c
    })()
    try {
      await this.connecting
    } catch {
      this.client = null
    } finally {
      this.connecting = null
    }
  }
}

const g = globalThis as unknown as { __routeBus?: Bus }
export function routeBus(): Bus {
  if (!g.__routeBus) {
    g.__routeBus = new Bus()
    g.__routeBus.setMaxListeners(500)
  }
  return g.__routeBus
}
