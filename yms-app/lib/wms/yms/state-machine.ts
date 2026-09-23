/** Очередь YMS. Переход только по этой таблице. */

export const YMS_STATUSES = [
  "expected",
  "at_gate",
  "awaiting_entry",
  "on_yard",
  "parked",
  "awaiting_dock",
  "to_dock",
  "loading",
  "unloading",
  "awaiting_docs",
  "ready_exit",
  "departed",
  "cancelled",
  "entry_denied",
  "no_show",
] as const

export type YmsStatus = (typeof YMS_STATUSES)[number]

export const YMS_OPERATIONS = ["INBOUND", "OUTBOUND", "CROSS_DOCK", "RETURN"] as const
export type YmsOperation = (typeof YMS_OPERATIONS)[number]

export const YMS_ACTIONS = [
  "arrive",
  "hold_entry",
  "allow_entry",
  "deny_entry",
  "park",
  "wait_dock",
  "assign_dock",
  "release_dock",
  "start_operation",
  "complete_operation",
  "release_exit",
  "depart",
  "cancel",
  "no_show",
] as const

export type YmsAction = (typeof YMS_ACTIONS)[number]

export const TERMINAL_STATUSES: ReadonlySet<YmsStatus> = new Set([
  "departed",
  "cancelled",
  "entry_denied",
  "no_show",
])

const CANCEL_FROM: ReadonlySet<YmsStatus> = new Set([
  "expected",
  "at_gate",
  "awaiting_entry",
  "on_yard",
  "parked",
  "awaiting_dock",
  "to_dock",
  "loading",
  "unloading",
  "awaiting_docs",
  "ready_exit",
])

export function isYmsStatus(value: string): value is YmsStatus {
  return (YMS_STATUSES as readonly string[]).includes(value)
}

export function isYmsOperation(value: string): value is YmsOperation {
  return (YMS_OPERATIONS as readonly string[]).includes(value)
}

export function isYmsAction(value: string): value is YmsAction {
  return (YMS_ACTIONS as readonly string[]).includes(value)
}

/** Погрузка для исходящих, разгрузка для входящих. Cross-dock в MVP начинает с разгрузки. */
export function workStatusFor(operation: YmsOperation): "loading" | "unloading" {
  if (operation === "OUTBOUND") return "loading"
  return "unloading"
}

export function resolveTransition(
  from: YmsStatus,
  action: YmsAction,
  operation: YmsOperation
): { ok: true; to: YmsStatus } | { ok: false; reason: string } {
  const work = workStatusFor(operation)
  let to: YmsStatus | null = null
  switch (action) {
    case "arrive":
      if (from === "expected") to = "at_gate"
      break
    case "hold_entry":
      if (from === "at_gate") to = "awaiting_entry"
      break
    case "allow_entry":
      if (from === "awaiting_entry") to = "on_yard"
      break
    case "deny_entry":
      if (from === "at_gate" || from === "awaiting_entry") to = "entry_denied"
      break
    case "park":
      if (from === "on_yard" || from === "awaiting_dock" || from === "parked") to = "parked"
      break
    case "wait_dock":
      if (from === "on_yard" || from === "parked") to = "awaiting_dock"
      break
    case "assign_dock":
      if (from === "on_yard" || from === "parked" || from === "awaiting_dock") to = "to_dock"
      break
    case "release_dock":
      if (from === "to_dock") to = "awaiting_dock"
      break
    case "start_operation":
      if (from === "to_dock") to = work
      break
    case "complete_operation":
      if (from === "loading" || from === "unloading") to = "awaiting_docs"
      break
    case "release_exit":
      if (from === "awaiting_docs") to = "ready_exit"
      break
    case "depart":
      if (from === "ready_exit") to = "departed"
      break
    case "cancel":
      if (CANCEL_FROM.has(from)) to = "cancelled"
      break
    case "no_show":
      if (from === "expected") to = "no_show"
      break
    default:
      break
  }
  if (!to) {
    return {
      ok: false,
      reason: `действие «${action}» недоступно из статуса «${from}»`,
    }
  }
  return { ok: true, to }
}

export function allowedActions(from: YmsStatus, operation: YmsOperation): YmsAction[] {
  return YMS_ACTIONS.filter((action) => resolveTransition(from, action, operation).ok)
}

export const STATUS_LABEL: Record<YmsStatus, string> = {
  expected: "Ожидается прибытие",
  at_gate: "Прибыл на КПП",
  awaiting_entry: "Ожидает въезда",
  on_yard: "На территории",
  parked: "На стоянке",
  awaiting_dock: "Ожидает док",
  to_dock: "Направляется к доку",
  loading: "Погрузка",
  unloading: "Разгрузка",
  awaiting_docs: "Ожидает документы",
  ready_exit: "Готов к выезду",
  departed: "Покинул территорию",
  cancelled: "Отменён",
  entry_denied: "Отказ во въезде",
  no_show: "Неявка",
}

export const OPERATION_LABEL: Record<YmsOperation, string> = {
  INBOUND: "Приёмка",
  OUTBOUND: "Отгрузка",
  CROSS_DOCK: "Кросс-док",
  RETURN: "Возврат",
}

export const ACTION_LABEL: Record<YmsAction, string> = {
  arrive: "Прибытие на КПП",
  hold_entry: "Проверка пропуска",
  allow_entry: "Разрешить въезд",
  deny_entry: "Отказ во въезде",
  park: "Назначить стоянку",
  wait_dock: "В очередь на док",
  assign_dock: "Назначить док",
  release_dock: "Снять с дока",
  start_operation: "Начать операцию",
  complete_operation: "Завершить операцию",
  release_exit: "Разрешить выезд",
  depart: "Зафиксировать выезд",
  cancel: "Отменить визит",
  no_show: "Неявка",
}

/** Статусы, при которых машина ещё на территории (для KPI). */
export const ON_YARD_STATUSES: YmsStatus[] = [
  "on_yard",
  "parked",
  "awaiting_dock",
  "to_dock",
  "loading",
  "unloading",
  "awaiting_docs",
  "ready_exit",
]
