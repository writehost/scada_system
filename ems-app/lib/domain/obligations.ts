// Коммунальные обязательства: повторения, статусы, напоминания.
// Оплата никогда не ставится автоматически — только подтверждением пользователя.

import { addDays, addMonths, diffDays, isDateKey, parseDateKey } from "./time.ts"

export type Recurrence =
  | { freq: "none" }
  | { freq: "monthly"; interval: number; day: number }
  | { freq: "yearly"; month: number; day: number }

export type ObligationStatus = "pending" | "due_soon" | "overdue" | "paid" | "cancelled"

export const STATUS_LABELS: Record<ObligationStatus, string> = {
  pending: "Ожидается",
  due_soon: "Скоро срок",
  overdue: "Просрочено",
  paid: "Оплачено",
  cancelled: "Отменено",
}

export function parseRecurrence(raw: unknown): Recurrence {
  const o = (raw ?? {}) as Record<string, unknown>
  if (o.freq === "monthly") {
    const interval = Math.round(Number(o.interval ?? 1))
    const day = Math.round(Number(o.day))
    if (!(interval >= 1 && interval <= 12)) throw new Error("Повторение: интервал 1–12 месяцев")
    if (!(day >= 1 && day <= 31)) throw new Error("Повторение: день месяца 1–31")
    return { freq: "monthly", interval, day }
  }
  if (o.freq === "yearly") {
    const month = Math.round(Number(o.month))
    const day = Math.round(Number(o.day))
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) throw new Error("Повторение: укажите месяц и день")
    return { freq: "yearly", month, day }
  }
  return { freq: "none" }
}

/** Следующая дата по правилу повторения. День 31 в коротком месяце становится последним днём. */
export function nextDueDate(current: string, rec: Recurrence): string | null {
  if (!isDateKey(current)) throw new Error("bad date")
  if (rec.freq === "monthly") return addMonths(current, rec.interval, rec.day)
  if (rec.freq === "yearly") {
    const { year } = parseDateKey(current)
    return addMonths(`${year + 1}-${String(rec.month).padStart(2, "0")}-01`, 0, rec.day)
  }
  return null
}

/** Срок передачи показаний сдвигается вместе со сроком оплаты. */
export function shiftWithDue(oldDue: string, newDue: string, related: string | null): string | null {
  if (!related) return null
  return addDays(newDue, diffDays(oldDue, related))
}

export function obligationStatus(o: { status: string; due_date: string; remind_days: number }, today: string): ObligationStatus {
  if (o.status === "paid") return "paid"
  if (o.status === "cancelled") return "cancelled"
  const left = diffDays(today, o.due_date)
  if (left < 0) return "overdue"
  if (left <= Math.max(o.remind_days, 0)) return "due_soon"
  return "pending"
}

/** Нужно ли сегодня напомнить: окно напоминания открылось и ещё не просрочено. */
export function reminderDue(dueDate: string, remindDays: number, today: string): boolean {
  const left = diffDays(today, dueDate)
  return left >= 0 && left <= remindDays
}
