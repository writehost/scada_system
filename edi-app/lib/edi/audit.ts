import type { PoolClient } from "pg"
import type { Actor } from "./actor.ts"

/** Журнал операций (аудит) и история документа — одна таблица edi_events. Записи только добавляются. */
export async function recordEvent(
  client: PoolClient,
  e: {
    siteId: number
    documentId?: string | number | null
    actorUserId?: string | null
    actorName?: string | null
    action: string
    details?: Record<string, unknown>
    ip?: string | null
  }
): Promise<void> {
  await client.query(
    `INSERT INTO edi_events (site_id, document_id, actor_user_id, actor_name, action, details, ip)
     VALUES ($1, $2::bigint, NULLIF($3, '')::bigint, $4, $5, $6::jsonb, $7)`,
    [e.siteId, e.documentId ?? null, e.actorUserId ?? "", e.actorName ?? null, e.action, JSON.stringify(e.details ?? {}), e.ip ?? null]
  )
}

export function actorEvent(actor: Actor, action: string, documentId?: string | number | null, details?: Record<string, unknown>) {
  return { siteId: actor.siteId, documentId, actorUserId: actor.userId, actorName: actor.fio, action, details }
}

export const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Вход",
  "document.created": "Создан",
  "document.imported": "Загружен из файла",
  "document.updated": "Изменён",
  "document.version": "Новая версия",
  "document.status": "Смена статуса",
  "document.archived": "Перемещён в архив",
  "document.restored": "Возвращён из архива",
  "document.deleted": "Удалён черновик",
  "document.downloaded": "Скачан файл",
  "document.file_added": "Добавлено вложение",
  "document.comment": "Комментарий",
  "document.access": "Изменён доступ",
  "document.related": "Связан с документом",
  "workflow.started": "Запущено согласование",
  "workflow.decision": "Решение по согласованию",
  "workflow.finished": "Согласование завершено",
  "workflow.escalated": "Эскалация",
  "workflow.cancelled": "Согласование отменено",
  "signature.added": "Добавлена подпись",
  "signature.checked": "Проверка подписи",
  "wms.receipt_draft": "Создан заказ на приход в WMS",
  "wms.receipt_synced": "Обновлён статус приёмки WMS",
  "wms.mapping_saved": "Сохранено сопоставление номенклатуры",
  "exchange.sent": "Отправлен оператору ЭДО",
  "exchange.status": "Статус обмена",
  "counterparty.created": "Создан контрагент",
  "counterparty.updated": "Изменён контрагент",
  "admin.settings": "Изменены настройки",
  "admin.roles": "Изменены роли",
  "admin.workflow": "Изменён маршрут",
  "admin.template": "Изменён шаблон",
  "admin.integration": "Изменена интеграция",
}
