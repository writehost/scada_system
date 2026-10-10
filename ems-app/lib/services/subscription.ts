import type { Db } from "../server/db.ts"
import { canIngest, canWrite, effectiveLimits, limitReached, resolveStatus, type LimitKey, type Limits, type SubscriptionStatus } from "../domain/plans.ts"
import { HttpError, planLimit } from "../server/errors.ts"

export type SubscriptionInfo = {
  planCode: string
  planName: string
  segment: "home" | "industrial"
  status: SubscriptionStatus
  storedStatus: SubscriptionStatus
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  priceMonth: number | null
  limits: Limits
  features: string[]
}

export async function getSubscription(c: Db, orgId: string): Promise<SubscriptionInfo> {
  const r = await c.query(
    `SELECT s.plan_code, p.name, p.segment, s.status, s.trial_ends_at, s.current_period_end, s.limits_override, p.limits, p.features, p.price_month
       FROM ems_subscriptions s JOIN ems_plans p ON p.plan_code = s.plan_code WHERE s.org_id = $1`,
    [orgId],
  )
  const row = r.rows[0]
  if (!row) throw new HttpError(409, "no_subscription", "У организации нет подписки SCADA EMS")
  return {
    planCode: row.plan_code,
    planName: row.name,
    segment: row.segment,
    status: resolveStatus(row),
    storedStatus: row.status,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
    priceMonth: row.price_month,
    limits: effectiveLimits(row.limits, row.limits_override),
    features: row.features ?? [],
  }
}

export async function assertWritable(c: Db, orgId: string): Promise<SubscriptionInfo> {
  const sub = await getSubscription(c, orgId)
  if (!canWrite(sub.status)) {
    throw new HttpError(402, "subscription_inactive", "Подписка SCADA EMS не активна: история доступна для просмотра, изменения недоступны до продления")
  }
  return sub
}

export async function assertIngest(c: Db, orgId: string): Promise<void> {
  const sub = await getSubscription(c, orgId)
  if (!canIngest(sub.status)) throw new HttpError(402, "subscription_inactive", "Подписка не активна, приём данных приостановлен. Шлюз сохранит данные в локальном буфере.")
}

const COUNT_SQL: Partial<Record<LimitKey, string>> = {
  sites: "SELECT count(*)::int AS n FROM ems_sites WHERE org_id = $1 AND archived_at IS NULL",
  meters: "SELECT count(*)::int AS n FROM ems_meters WHERE org_id = $1 AND status IN ('active','draft')",
  gateways: "SELECT count(*)::int AS n FROM ems_gateways WHERE org_id = $1 AND archived_at IS NULL",
  users: `SELECT (SELECT count(*) FROM ems_memberships WHERE org_id = $1) + (SELECT count(*) FROM ems_invitations WHERE org_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())::int AS n`,
  recipients: "SELECT count(*)::int AS n FROM ems_email_recipients WHERE org_id = $1",
}

export async function usage(c: Db, orgId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const [k, sql] of Object.entries(COUNT_SQL)) {
    out[k] = Number((await c.query(sql!, [orgId])).rows[0].n)
  }
  const m = await c.query("SELECT emails_sent, readings_ingested FROM ems_usage_counters WHERE org_id = $1 AND month = date_trunc('month', now())::date", [orgId])
  out.emails_month = m.rows[0]?.emails_sent ?? 0
  out.readings_month = Number(m.rows[0]?.readings_ingested ?? 0)
  return out
}

export const LIMIT_MESSAGES: Partial<Record<LimitKey, string>> = {
  sites: "Достигнут лимит объектов по тарифу",
  meters: "Достигнут лимит приборов по тарифу",
  gateways: "Достигнут лимит шлюзов по тарифу",
  users: "Достигнут лимит пользователей по тарифу",
  recipients: "Достигнут лимит адресов для уведомлений по тарифу",
}

/** Проверка лимита перед созданием. Бросает 402 с подсказкой сменить тариф. */
export async function assertLimit(c: Db, orgId: string, key: LimitKey, adding = 1): Promise<void> {
  const sub = await assertWritable(c, orgId)
  const limit = sub.limits[key]
  if (limit == null) return
  const used = Number((await c.query(COUNT_SQL[key]!, [orgId])).rows[0].n)
  if (limitReached(limit, used, adding)) {
    throw planLimit(`${LIMIT_MESSAGES[key] ?? "Достигнут лимит тарифа"} «${sub.planName}»: ${used} из ${limit}. Перейдите на тариф выше в разделе «Подписка».`, { key, used, limit })
  }
}

export function hasFeature(sub: SubscriptionInfo, feature: string): boolean {
  return sub.features.includes(feature)
}
