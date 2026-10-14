import type { PoolClient } from "pg"

export const NOTIFY_EVENTS: Record<string, string> = {
  "document.received": "Получен новый документ",
  "task.assigned": "Назначено согласование",
  "signature.requested": "Запрошена подпись",
  "document.rejected": "Документ отклонён",
  "document.approved": "Документ согласован",
  "document.rework": "Возвращён на доработку",
  "exchange.reply": "Контрагент ответил",
  "task.due_soon": "Срок согласования заканчивается",
  "task.overdue": "Просрочено согласование",
  "signature.invalid": "Подпись не прошла проверку",
  "exchange.error": "Ошибка отправки через оператора ЭДО",
  "wms.received": "Склад принял товар",
  "wms.discrepancy": "Приёмка с расхождениями",
}

export type Channel = "inapp" | "email" | "wms" | "webhook"

/** Каналы по умолчанию; пользователь меняет их в профиле (edi_user_profiles.prefs.notifications). */
const DEFAULT_CHANNELS: Record<string, Channel[]> = {
  "task.assigned": ["inapp", "wms", "email"],
  "signature.requested": ["inapp", "wms", "email"],
  "task.overdue": ["inapp", "wms", "email"],
  "task.due_soon": ["inapp", "wms"],
  "exchange.error": ["inapp", "email"],
  "signature.invalid": ["inapp", "email"],
}

export const EDI_EVENTS_CHANNEL = "edi_events"

export function channelsFor(event: string, prefs: Record<string, unknown> | null | undefined): Channel[] {
  const custom = (prefs?.notifications as Record<string, Channel[]> | undefined)?.[event]
  const list = Array.isArray(custom) ? custom : DEFAULT_CHANNELS[event] ?? ["inapp"]
  return [...new Set<Channel>(["inapp", ...list.filter((c) => ["email", "wms"].includes(c))])]
}

/**
 * Создаёт уведомления. Повторяющееся событие с тем же dedupe_key пользователю не дублируется
 * (уникальный индекс), поэтому повторные срабатывания эскалации/синхронизации не спамят.
 */
export async function notifyUsers(
  client: PoolClient,
  input: {
    siteId: number
    userIds: string[]
    event: string
    title: string
    body?: string | null
    documentId?: string | null
    taskId?: string | null
    dedupeKey: string
    excludeUserId?: string | null
  }
): Promise<number> {
  const users = [...new Set(input.userIds.filter((u) => u && u !== input.excludeUserId))]
  let created = 0
  for (const userId of users) {
    const r = await client.query<{ notification_id: string }>(
      `INSERT INTO edi_notifications (site_id, user_id, event, title, body, document_id, task_id, dedupe_key)
       VALUES ($1, $2::bigint, $3, $4, $5, $6::bigint, $7::bigint, $8)
       ON CONFLICT (site_id, user_id, dedupe_key) DO NOTHING
       RETURNING notification_id::text`,
      [input.siteId, userId, input.event, input.title.slice(0, 300), input.body?.slice(0, 2000) ?? null, input.documentId ?? null, input.taskId ?? null, input.dedupeKey]
    )
    const id = r.rows[0]?.notification_id
    if (!id) continue
    created++
    const prof = await client.query<{ prefs: Record<string, unknown>; email: string | null }>(
      `SELECT prefs, email FROM edi_user_profiles WHERE site_id = $1 AND user_id = $2::bigint`,
      [input.siteId, userId]
    )
    const channels = channelsFor(input.event, prof.rows[0]?.prefs)
    for (const ch of channels) {
      if (ch === "inapp") continue
      if (ch === "email" && !prof.rows[0]?.email) continue
      await client.query(
        `INSERT INTO edi_deliveries (site_id, notification_id, channel, target, payload)
         VALUES ($1, $2::bigint, $3, $4, $5::jsonb)`,
        [input.siteId, id, ch, ch === "email" ? prof.rows[0]?.email : userId, JSON.stringify({ event: input.event })]
      )
    }
    await client.query(`SELECT pg_notify($1, $2)`, [
      EDI_EVENTS_CHANNEL,
      JSON.stringify({ siteId: input.siteId, userId, kind: "notification", documentId: input.documentId ?? null }),
    ])
  }
  // Вебхуки организации получают событие один раз, без привязки к пользователю
  const hooks = await client.query<{ webhook_id: string }>(
    `SELECT webhook_id::text FROM edi_webhooks WHERE site_id = $1 AND is_active AND ($2 = ANY(events) OR cardinality(events) = 0)`,
    [input.siteId, input.event]
  )
  for (const h of hooks.rows) {
    await client.query(
      `INSERT INTO edi_deliveries (site_id, channel, target, payload)
       SELECT $1, 'webhook', $2, $3::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM edi_deliveries WHERE channel = 'webhook' AND target = $2 AND payload->>'dedupeKey' = $4)`,
      [
        input.siteId,
        h.webhook_id,
        JSON.stringify({ event: input.event, title: input.title, documentId: input.documentId ?? null, dedupeKey: input.dedupeKey, at: new Date().toISOString() }),
        input.dedupeKey,
      ]
    )
  }
  return created
}

/** Сигнал интерфейсу (SSE) об изменении документа — без содержимого, клиент сам перечитает с проверкой прав. */
export async function signalDocument(client: PoolClient, siteId: number, documentId: string) {
  await client.query(`SELECT pg_notify($1, $2)`, [EDI_EVENTS_CHANNEL, JSON.stringify({ siteId, kind: "document", documentId })])
}
