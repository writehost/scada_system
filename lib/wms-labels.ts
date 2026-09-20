/** Человекочитаемые подписи для кодов WMS (RU). */

const DOC_STATUS: Record<string, string> = {
  draft: "Черновик",
  open: "Открыт",
  new: "Новый",
  planned: "Запланирован",
  active: "Активен",
  paused: "Пауза",
  unknown: "Неизвестно",
  in_progress: "В работе",
  inprogress: "В работе",
  released: "Выпущен",
  posted: "Проведён",
  applied: "Проведён",
  completed: "Завершён",
  complete: "Завершён",
  closed: "Закрыт",
  cancelled: "Отменён",
  canceled: "Отменён",
  suspended: "Приостановлен",
  on_hold: "На паузе",
  exception: "Исключение",
  error: "Ошибка",
}

const TASK_STATUS: Record<string, string> = {
  planned: "Запланировано",
  queued: "В очереди",
  claimed: "Захвачено",
  in_progress: "В работе",
  suspended: "Приостановлено",
  on_hold: "На паузе",
  completed: "Выполнено",
  cancelled: "Отменено",
  canceled: "Отменено",
  exception: "Исключение",
  failed: "Сбой",
}

const SEVERITY: Record<string, string> = {
  info: "Информация",
  informational: "Информация",
  low: "Низкая",
  warn: "Предупреждение",
  warning: "Предупреждение",
  medium: "Средняя",
  high: "Высокая",
  critical: "Критично",
  error: "Ошибка",
}

const DOC_TYPE: Record<string, string> = {
  receiving: "Приёмка",
  shipment: "Отгрузка",
  shipping: "Отгрузка",
  transfer: "Перемещение",
  interwarehouse_transfer: "Перемещение",
  issue: "Выдача",
  picking: "Отбор",
  putaway: "Размещение",
  inventory: "Инвентаризация",
  adjustment: "Корректировка",
  return: "Возврат",
  revision: "Ревизия",
  production_consumption: "Списание с линии",
  writeoff: "Списание",
  scanner_collect: "Список сканов",
  aggregation_block_doc: "Агрегация блоков",
  aggregation_pallet_doc: "Агрегация паллет",
  aggregation_extract_doc: "Изъятие из паллеты",
}

const ROLE_RU: Record<string, string> = {
  admin: "Администратор",
  warehouse_manager: "Начальник склада",
  warehouse_operator: "Кладовщик",
  line_operator: "Оператор линии",
  auditor: "Ревизор",
}

function normKey(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase().replace(/-/g, "_")
}

export function documentStatusLabelRU(code: string | null | undefined): string {
  const k = normKey(code)
  if (!k) return "—"
  return DOC_STATUS[k] ?? code ?? "—"
}

export function taskStatusLabelRU(code: string | null | undefined): string {
  const k = normKey(code)
  if (!k) return "—"
  return TASK_STATUS[k] ?? code ?? "—"
}

export function severityLabelRU(code: string | null | undefined): string {
  const k = normKey(code)
  if (!k) return "—"
  return SEVERITY[k] ?? code ?? "—"
}

export function documentTypeLabelRU(code: string | null | undefined): string {
  const k = normKey(code)
  if (!k) return "—"
  return DOC_TYPE[k] ?? code ?? "—"
}

export function wmsRoleLabelRU(code: string | null | undefined): string {
  const k = normKey(code)
  if (!k) return "—"
  return ROLE_RU[k] ?? code ?? "—"
}

const MOVEMENT_TYPE: Record<string, string> = {
  receiving: "Приёмка",
  putaway: "Размещение",
  picking: "Сборка",
  shipping: "Отгрузка",
  transfer: "Перемещение",
  issue: "Выдача",
  return: "Возврат",
  revision_adjustment: "Корректировка ревизией",
  replenishment: "Подпитка",
  interwarehouse_ship: "Межскладская отгрузка",
  interwarehouse_receive: "Межскладская приёмка",
  production_consume: "Списание с линии",
  writeoff: "Списание",
}

const LOCATION_STATUS: Record<string, string> = {
  active: "Доступна",
  blocked: "Заблокирована",
  quarantine: "Карантин",
  disabled: "Выведена",
}

const ACCURACY_STATUS: Record<string, string> = {
  unchecked: "Не проверено",
  checked: "Проверено",
  recount_required: "Нужна сверка",
}

export function movementTypeLabelRU(code: string | null | undefined): string {
  const k = normKey(code)
  if (!k) return "—"
  return MOVEMENT_TYPE[k] ?? code ?? "—"
}

export function locationStatusLabelRU(code: string | null | undefined): string {
  const k = normKey(code)
  if (!k) return "—"
  if (k.includes("block")) return "Заблокирована"
  return LOCATION_STATUS[k] ?? code ?? "—"
}

export function accuracyStatusLabelRU(code: string | null | undefined): string {
  const k = normKey(code)
  if (!k) return "—"
  return ACCURACY_STATUS[k] ?? code ?? "—"
}

/** Короткое описание для заголовков календаря вида «receiving #7». */
export function warehouseDisplayName(code?: string | null, name?: string | null): string {
  const c = (code || "").trim()
  const n = (name || "").trim()
  if (n && c && n.toLowerCase() !== c.toLowerCase()) return `${n} (${c})`
  return n || c
}

/** Межскладской маршрут — имена складов, не код ячейки приёмки вроде FG-VVO-IN. */
export function warehouseRouteLabel(input: {
  sourceWarehouseCode?: string | null
  targetWarehouseCode?: string | null
  sourceWarehouseName?: string | null
  targetWarehouseName?: string | null
  sourceLocationCode?: string | null
  targetLocationCode?: string | null
}): string {
  const fromWh = warehouseDisplayName(input.sourceWarehouseCode, input.sourceWarehouseName)
  const toWh = warehouseDisplayName(input.targetWarehouseCode, input.targetWarehouseName)
  const differentWarehouses =
    Boolean(
      input.sourceWarehouseCode &&
        input.targetWarehouseCode &&
        input.sourceWarehouseCode !== input.targetWarehouseCode
    ) || Boolean(fromWh && toWh && fromWh !== toWh)
  if (differentWarehouses && (fromWh || toWh)) {
    return `${fromWh || "откуда не задано"} → ${toWh || "куда не задано"}`
  }
  const from = (input.sourceLocationCode || fromWh || "").trim()
  const to = (input.targetLocationCode || toWh || "").trim()
  if (!from && !to) return ""
  return `${from || "откуда не задано"} → ${to || "куда не задано"}`
}

export function calendarEventTitleRU(title: string): string {
  const m = /^([a-zA-Z_]+)\s*#\s*(\d+)\s*$/.exec(title.trim())
  if (!m) return title
  const typeRu = documentTypeLabelRU(m[1])
  const num = m[2]
  if (typeRu === m[1]) return title
  return `${typeRu} №${num}`
}
