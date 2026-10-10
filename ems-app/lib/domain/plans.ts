// Лимиты тарифных планов SCADA EMS (подписка платформы — не коммунальные платежи).

export type LimitKey = "sites" | "meters" | "gateways" | "users" | "recipients" | "emails_month" | "raw_retention_days" | "min_poll_sec"

export type Limits = Record<LimitKey, number | null>

export type SubscriptionStatus = "trial" | "active" | "past_due" | "expired" | "cancelled"

export const LIMIT_LABELS: Record<LimitKey, string> = {
  sites: "Объекты",
  meters: "Приборы учёта",
  gateways: "Шлюзы",
  users: "Пользователи",
  recipients: "Адреса для уведомлений",
  emails_month: "Писем в месяц",
  raw_retention_days: "Детальная история, дней",
  min_poll_sec: "Минимальный интервал опроса, с",
}

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trial: "Пробный период",
  active: "Активна",
  past_due: "Ожидает оплаты",
  expired: "Истекла",
  cancelled: "Отменена",
}

/** После окончания оплаченного периода данные продолжают приниматься ещё столько дней. */
export const GRACE_DAYS = 30

export function effectiveLimits(planLimits: Record<string, unknown>, override: Record<string, unknown> | null | undefined): Limits {
  const keys: LimitKey[] = ["sites", "meters", "gateways", "users", "recipients", "emails_month", "raw_retention_days", "min_poll_sec"]
  const out = {} as Limits
  for (const k of keys) {
    const src = override && k in override ? override[k] : planLimits[k]
    out[k] = src == null ? null : Number(src)
  }
  return out
}

/** Статус с учётом дат: просроченный пробный период превращается в expired. */
export function resolveStatus(sub: { status: SubscriptionStatus; trial_ends_at: string | Date | null; current_period_end: string | Date | null }, now = Date.now()): SubscriptionStatus {
  const t = (v: string | Date | null) => (v == null ? null : new Date(v).getTime())
  if (sub.status === "trial") {
    const end = t(sub.trial_ends_at)
    return end != null && end < now ? "expired" : "trial"
  }
  if (sub.status === "active") {
    const end = t(sub.current_period_end)
    if (end != null && end < now) return end + GRACE_DAYS * 86_400_000 < now ? "expired" : "past_due"
  }
  return sub.status
}

/** Можно ли создавать новые сущности и менять настройки. История доступна всегда. */
export function canWrite(status: SubscriptionStatus): boolean {
  return status === "trial" || status === "active" || status === "past_due"
}

/** Принимать ли телеметрию. Данные не удаляются ни в каком статусе. */
export function canIngest(status: SubscriptionStatus): boolean {
  return status !== "cancelled" && status !== "expired"
}

export function limitReached(limit: number | null, used: number, adding = 1): boolean {
  return limit != null && used + adding > limit
}

export function nearLimit(limit: number | null, used: number): boolean {
  return limit != null && limit > 0 && used / limit >= 0.8
}
