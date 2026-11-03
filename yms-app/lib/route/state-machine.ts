/**
 * Единая конечная машина состояний транспортного задания SCADA System Route.
 * Переход разрешён только по этой таблице. Сервер — единственный, кто её применяет.
 */

export const ROUTE_TASK_STATUSES = [
  "CREATED",
  "QUEUED",
  "OFFERED",
  "ACCEPTED",
  "EN_ROUTE_PICKUP",
  "AT_PICKUP",
  "LOAD_CONFIRMED",
  "EN_ROUTE_DROPOFF",
  "AT_DROPOFF",
  "COMPLETED",
  "PAUSED",
  "BLOCKED",
  "CANCELLED",
] as const

export type RouteTaskStatus = (typeof ROUTE_TASK_STATUSES)[number]

export const ROUTE_TASK_TYPES = [
  "PRODUCTION_PICKUP",
  "PUTAWAY",
  "RELOCATION",
  "SHIPPING_PICK",
  "STAGING",
  "RETURN",
  "EXCEPTION_MOVE",
] as const

export type RouteTaskType = (typeof ROUTE_TASK_TYPES)[number]

export const ROUTE_ACTIONS = [
  "queue",
  "offer",
  "decline",
  "accept",
  "start_pickup",
  "arrive_pickup",
  "confirm_load",
  "start_dropoff",
  "arrive_dropoff",
  "redirect",
  "complete",
  "pause",
  "resume",
  "block",
  "unblock",
  "requeue",
  "cancel",
] as const

export type RouteAction = (typeof ROUTE_ACTIONS)[number]

export const TERMINAL: ReadonlySet<RouteTaskStatus> = new Set(["COMPLETED", "CANCELLED"])

/** Задание закреплено за водителем и погрузчиком. Одно на погрузчик. */
export const DRIVER_ACTIVE: ReadonlySet<RouteTaskStatus> = new Set([
  "ACCEPTED",
  "EN_ROUTE_PICKUP",
  "AT_PICKUP",
  "LOAD_CONFIRMED",
  "EN_ROUTE_DROPOFF",
  "AT_DROPOFF",
])

/** Палета физически на вилах. */
export const LOADED: ReadonlySet<RouteTaskStatus> = new Set([
  "LOAD_CONFIRMED",
  "EN_ROUTE_DROPOFF",
  "AT_DROPOFF",
])

const PAUSABLE: ReadonlySet<RouteTaskStatus> = new Set([
  "ACCEPTED",
  "EN_ROUTE_PICKUP",
  "AT_PICKUP",
  "LOAD_CONFIRMED",
  "EN_ROUTE_DROPOFF",
  "AT_DROPOFF",
])

const BLOCKABLE: ReadonlySet<RouteTaskStatus> = new Set([
  "CREATED",
  "QUEUED",
  "OFFERED",
  "ACCEPTED",
  "EN_ROUTE_PICKUP",
  "AT_PICKUP",
  "LOAD_CONFIRMED",
  "EN_ROUTE_DROPOFF",
  "AT_DROPOFF",
  "PAUSED",
])

const REQUEUE_FROM: ReadonlySet<RouteTaskStatus> = new Set([
  "CREATED",
  "OFFERED",
  "ACCEPTED",
  "EN_ROUTE_PICKUP",
  "AT_PICKUP",
])

export function isRouteStatus(value: unknown): value is RouteTaskStatus {
  return typeof value === "string" && (ROUTE_TASK_STATUSES as readonly string[]).includes(value)
}

export function isRouteAction(value: unknown): value is RouteAction {
  return typeof value === "string" && (ROUTE_ACTIONS as readonly string[]).includes(value)
}

export function isRouteTaskType(value: unknown): value is RouteTaskType {
  return typeof value === "string" && (ROUTE_TASK_TYPES as readonly string[]).includes(value)
}

/** Палета на вилах с учётом паузы/блокировки (смотрим на статус, в который вернёмся). */
export function isLoaded(status: RouteTaskStatus, resumeStatus: RouteTaskStatus | null): boolean {
  if (LOADED.has(status)) return true
  if ((status === "PAUSED" || status === "BLOCKED") && resumeStatus) return LOADED.has(resumeStatus)
  return false
}

export type TransitionResult =
  | { ok: true; to: RouteTaskStatus; resumeStatus: RouteTaskStatus | null }
  | { ok: false; code: string; reason: string }

export function resolveRouteTransition(
  from: RouteTaskStatus,
  action: RouteAction,
  resumeStatus: RouteTaskStatus | null = null
): TransitionResult {
  const keep = { resumeStatus: null as RouteTaskStatus | null }
  let to: RouteTaskStatus | null = null
  switch (action) {
    case "queue":
      if (from === "CREATED") to = "QUEUED"
      break
    case "offer":
      if (from === "QUEUED") to = "OFFERED"
      break
    case "decline":
      if (from === "OFFERED") to = "QUEUED"
      break
    case "accept":
      if (from === "OFFERED") to = "ACCEPTED"
      break
    case "start_pickup":
      if (from === "ACCEPTED") to = "EN_ROUTE_PICKUP"
      break
    case "arrive_pickup":
      if (from === "EN_ROUTE_PICKUP") to = "AT_PICKUP"
      break
    case "confirm_load":
      if (from === "AT_PICKUP") to = "LOAD_CONFIRMED"
      break
    case "start_dropoff":
      if (from === "LOAD_CONFIRMED") to = "EN_ROUTE_DROPOFF"
      break
    case "arrive_dropoff":
      if (from === "EN_ROUTE_DROPOFF") to = "AT_DROPOFF"
      break
    case "redirect":
      if (from === "EN_ROUTE_DROPOFF" || from === "AT_DROPOFF") to = "EN_ROUTE_DROPOFF"
      if (from === "BLOCKED" && resumeStatus && LOADED.has(resumeStatus)) to = "EN_ROUTE_DROPOFF"
      break
    case "complete":
      if (from === "AT_DROPOFF") to = "COMPLETED"
      break
    case "pause":
      if (PAUSABLE.has(from)) {
        return { ok: true, to: "PAUSED", resumeStatus: from }
      }
      break
    case "resume":
      if (from === "PAUSED" && resumeStatus) to = resumeStatus
      break
    case "block":
      if (BLOCKABLE.has(from)) {
        return {
          ok: true,
          to: "BLOCKED",
          resumeStatus: from === "PAUSED" ? resumeStatus : from,
        }
      }
      break
    case "unblock":
      if (from === "BLOCKED") to = resumeStatus ?? "QUEUED"
      break
    case "requeue":
      if (REQUEUE_FROM.has(from)) to = "QUEUED"
      if ((from === "PAUSED" || from === "BLOCKED") && !isLoaded(from, resumeStatus)) to = "QUEUED"
      break
    case "cancel":
      if (!TERMINAL.has(from)) to = "CANCELLED"
      break
    default:
      break
  }
  if (!to) {
    return {
      ok: false,
      code: "invalid_transition",
      reason: `действие «${ACTION_LABEL[action] ?? action}» недоступно из статуса «${STATUS_LABEL[from]}»`,
    }
  }
  return { ok: true, to, ...keep }
}

export function allowedRouteActions(
  from: RouteTaskStatus,
  resumeStatus: RouteTaskStatus | null = null
): RouteAction[] {
  return ROUTE_ACTIONS.filter((action) => resolveRouteTransition(from, action, resumeStatus).ok)
}

export const STATUS_LABEL: Record<RouteTaskStatus, string> = {
  CREATED: "Создано",
  QUEUED: "Ожидает назначения",
  OFFERED: "Предложено водителю",
  ACCEPTED: "Принято",
  EN_ROUTE_PICKUP: "Движение к грузу",
  AT_PICKUP: "У места получения",
  LOAD_CONFIRMED: "Груз погружен",
  EN_ROUTE_DROPOFF: "Движение к назначению",
  AT_DROPOFF: "У места назначения",
  COMPLETED: "Выполнено",
  PAUSED: "Приостановлено",
  BLOCKED: "Требуется вмешательство",
  CANCELLED: "Отменено",
}

export const TYPE_LABEL: Record<RouteTaskType, string> = {
  PRODUCTION_PICKUP: "Забрать с линии",
  PUTAWAY: "Разместить на хранение",
  RELOCATION: "Переставить палету",
  SHIPPING_PICK: "Забрать на отгрузку",
  STAGING: "В буферную зону",
  RETURN: "Вернуть на склад",
  EXCEPTION_MOVE: "Перемещение по разрешению",
}

export const ACTION_LABEL: Record<RouteAction, string> = {
  queue: "В очередь",
  offer: "Предложить",
  decline: "Отказаться",
  accept: "Принять",
  start_pickup: "Ехать к грузу",
  arrive_pickup: "Я на месте получения",
  confirm_load: "Подтвердить погрузку",
  start_dropoff: "Ехать к назначению",
  arrive_dropoff: "Я на месте назначения",
  redirect: "Новый адрес",
  complete: "Подтвердить постановку",
  pause: "Пауза",
  resume: "Продолжить",
  block: "Заблокировать",
  unblock: "Снять блокировку",
  requeue: "Вернуть в очередь",
  cancel: "Отменить",
}

/** Приоритет назначения: срочность типа операции (выше — важнее). FEFO решает WMS. */
export const TYPE_URGENCY: Record<RouteTaskType, number> = {
  PRODUCTION_PICKUP: 30,
  SHIPPING_PICK: 30,
  STAGING: 20,
  EXCEPTION_MOVE: 20,
  RETURN: 10,
  PUTAWAY: 10,
  RELOCATION: 0,
}
