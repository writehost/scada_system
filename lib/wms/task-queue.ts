import type { WmsTaskRow } from "@/lib/wms-api"

export type TaskKind =
  | "putaway"
  | "move"
  | "pick"
  | "replenish"
  | "receive"
  | "check_cell"
  | "inventory"
  | "ship"
  | "quarantine"
  | "return_line"
  | "confirm_stock"
  | "empty_tare"
  | "resolve"
  | "resort"
  | "other"

export type UserTaskStatus = "ready" | "active" | "waiting" | "blocked" | "done" | "cancelled"

export const KIND_TITLE: Record<TaskKind, string> = {
  putaway: "РАЗМЕСТИТЬ ПАЛЕТУ",
  move: "ПЕРЕМЕСТИТЬ ПАЛЕТУ",
  pick: "ОТОБРАТЬ ПАЛЕТУ",
  replenish: "ПОПОЛНИТЬ ЛИНИЮ",
  receive: "ПРИНЯТЬ ТОВАР",
  check_cell: "ПРОВЕРИТЬ ЯЧЕЙКУ",
  inventory: "ИНВЕНТАРИЗАЦИЯ",
  ship: "ОТГРУЗИТЬ",
  quarantine: "В КАРАНТИН",
  return_line: "ВЕРНУТЬ С ЛИНИИ",
  confirm_stock: "ПОДТВЕРДИТЬ ОСТАТОК",
  empty_tare: "ЗАБРАТЬ ТАРУ",
  resolve: "УСТРАНИТЬ РАСХОЖДЕНИЕ",
  resort: "ПЕРЕБРАТЬ ПАЛЕТУ",
  other: "ЗАДАНИЕ",
}

export const STATUS_LABEL: Record<UserTaskStatus, string> = {
  ready: "Готово к выполнению",
  active: "В работе",
  waiting: "Ожидает",
  blocked: "Заблокировано",
  done: "Завершено",
  cancelled: "Отменено",
}

export type ScoredTask = {
  raw: WmsTaskRow
  kind: TaskKind
  userStatus: UserTaskStatus
  score: number
  reason: string
  urgent: boolean
  overdue: boolean
  dueLabel: string | null
  fromLabel: string
  toLabel: string
  objectLabel: string
}

function loc(...parts: Array<string | null | undefined>) {
  return parts.find((p) => (p || "").trim())?.trim() || "—"
}

export function kindOf(type?: string | null, payload?: Record<string, unknown> | null): TaskKind {
  const kind = typeof payload?.kind === "string" ? payload.kind.toLowerCase() : ""
  if (kind === "fg_resort" || kind.includes("resort")) return "resort"
  const t = (type || "").toLowerCase()
  if (t.includes("resort") || t.includes("перебор")) return "resort"
  if (t.includes("putaway") || t.includes("place")) return "putaway"
  if (t.includes("replenish") || t.includes("issue_to_line")) return "replenish"
  if (t.includes("return_from")) return "return_line"
  if (t.includes("quarantine")) return "quarantine"
  if (t.includes("empty") || t.includes("tare")) return "empty_tare"
  if (t.includes("inventor") || t.includes("revision") || t.includes("cycle")) return "inventory"
  if (t.includes("receipt") || t.includes("receiv")) return "receive"
  if (t.includes("ship")) return "ship"
  if (t.includes("pick")) return "pick"
  if (t.includes("transfer") || t.includes("move")) return "move"
  return "other"
}

export function userStatusOf(row: WmsTaskRow): UserTaskStatus {
  if (row.completedAt) return "done"
  const s = (row.taskStatus || "").trim().toLowerCase().replace(/\s+/g, "_")
  if (s === "cancelled" || s === "canceled") return "cancelled"
  if (s === "exception" || s === "failed" || s === "blocked" || row.exceptionCode) return "blocked"
  if (s === "on_hold" || s === "waiting") return "waiting"
  if (s === "claimed" || s === "in_progress" || s === "started" || s === "assigned") return "active"
  if (s === "completed" || s === "done") return "done"
  return "ready"
}

export function scoreTask(row: WmsTaskRow, now = Date.now(), zone?: string | null): ScoredTask {
  const kind = kindOf(row.taskType)
  const userStatus = userStatusOf(row)
  const priority =
    row.priorityCode === "urgent" ? 40 : row.priorityCode === "high" ? 28 : row.priorityCode === "low" ? 6 : 14
  const due = row.dueAt ? Date.parse(row.dueAt) : NaN
  const minutes = Number.isFinite(due) ? (due - now) / 60000 : null
  const sla = minutes == null ? 0 : minutes < 0 ? 30 : minutes <= 15 ? 26 : minutes <= 60 ? 16 : minutes <= 240 ? 8 : 2
  const production = kind === "replenish" ? 22 : kind === "return_line" ? 10 : 0
  const shipping = kind === "ship" ? 20 : kind === "pick" ? 18 : 0
  const fefo = kind === "pick" || kind === "ship" ? (minutes != null && minutes <= 240 ? 10 : 4) : 0
  const from = loc(row.sourceLocationCode, row.sourceWarehouseName, row.sourceWarehouseCode)
  const to = loc(row.targetLocationCode, row.targetWarehouseName, row.targetWarehouseCode)
  const zoneBonus = zone && (from.startsWith(zone) || to.startsWith(zone)) ? 10 : 0
  const score = Math.max(0, Math.min(100, priority + sla + production + shipping + fefo + zoneBonus + 2))
  const overdue = Number.isFinite(due) && due < now && userStatus !== "done" && userStatus !== "cancelled"
  const urgent = overdue || row.priorityCode === "urgent" || row.priorityCode === "high" || (minutes != null && minutes <= 15)
  const dueLabel = Number.isFinite(due)
    ? `${overdue ? "просрочено " : "до "}${new Date(due).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
    : null
  const reason =
    minutes != null && minutes < 0
      ? "срок уже прошёл"
      : minutes != null && minutes <= 15
        ? `срок через ${Math.round(minutes)} мин`
        : kind === "replenish"
          ? "линия ждёт пополнение"
          : kind === "ship" || kind === "pick"
            ? "нужно для отгрузки"
            : "следующая по маршруту"
  return {
    raw: row,
    kind,
    userStatus,
    score,
    reason,
    urgent,
    overdue,
    dueLabel,
    fromLabel: from,
    toLabel: to,
    objectLabel: row.itemName || row.itemCode || row.taskCode || `#${row.taskId}`,
  }
}

export function buildQueue(rows: WmsTaskRow[], now = Date.now(), zone?: string | null) {
  const scored = rows.map((r) => scoreTask(r, now, zone)).sort((a, b) => b.score - a.score)
  const live = scored.filter((t) => t.userStatus !== "done" && t.userStatus !== "cancelled")
  const history = scored.filter((t) => t.userStatus === "done" || t.userStatus === "cancelled")
  const active = live.find((t) => t.userStatus === "active") || null
  const recommended = live.filter((t) => t !== active && (t.score >= 40 || t.urgent)).slice(0, 3)
  const queue = live.filter((t) => t !== active && !recommended.includes(t))
  return {
    scored,
    live,
    history,
    active,
    recommended,
    queue,
    openCount: live.length,
    urgentCount: live.filter((t) => t.urgent).length,
    overdueCount: live.filter((t) => t.overdue).length,
    doneToday: history.length,
  }
}

export function matchesQuery(row: WmsTaskRow, q: string) {
  if (!q.trim()) return true
  const hay = [
    row.taskId,
    row.taskCode,
    row.taskType,
    row.itemCode,
    row.itemName,
    row.sourceLocationCode,
    row.targetLocationCode,
    row.lotCode,
    row.documentNo,
  ]
    .join(" ")
    .toLowerCase()
  return hay.includes(q.trim().toLowerCase())
}
