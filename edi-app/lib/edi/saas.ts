import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"

export type PlanFeatures = Record<string, boolean>
export type PlanLimits = { users?: number | null; documentsPerMonth?: number | null; storageMb?: number | null; trialDays?: number }

export type Subscription = {
  planCode: string
  planName: string
  status: string
  validTo: string | null
  limits: PlanLimits
  features: PlanFeatures
}

/** Подписка организации. Если записи нет — создаётся план из EDI_DEFAULT_PLAN (по умолчанию trial). */
export async function loadSubscription(client: PoolClient, siteId: number): Promise<Subscription> {
  let r = await client.query(
    `SELECT s.plan_code, p.name, s.status, s.valid_to::text, p.limits, p.features, s.custom_limits
     FROM edi_subscriptions s JOIN edi_plans p ON p.plan_code = s.plan_code WHERE s.site_id = $1`,
    [siteId]
  )
  if (!r.rows[0]) {
    const plan = (process.env.EDI_DEFAULT_PLAN || "trial").trim()
    const days = plan === "trial" ? 30 : null
    await client.query(
      `INSERT INTO edi_subscriptions (site_id, plan_code, status, valid_to)
       SELECT $1, plan_code, 'active', CASE WHEN $3::int IS NULL THEN NULL ELSE current_date + $3::int END
       FROM edi_plans WHERE plan_code = $2
       ON CONFLICT (site_id) DO NOTHING`,
      [siteId, plan, days]
    )
    r = await client.query(
      `SELECT s.plan_code, p.name, s.status, s.valid_to::text, p.limits, p.features, s.custom_limits
       FROM edi_subscriptions s JOIN edi_plans p ON p.plan_code = s.plan_code WHERE s.site_id = $1`,
      [siteId]
    )
  }
  const row = r.rows[0]
  if (!row) throw new HttpError(503, "Тарифные планы не настроены", "plans_missing")
  const custom = (row.custom_limits ?? {}) as Record<string, unknown>
  const features = { ...(row.features as PlanFeatures), ...((custom.features as PlanFeatures) ?? {}) }
  const limits = { ...(row.limits as PlanLimits), ...((custom.limits as PlanLimits) ?? {}) }
  const expired = row.valid_to && row.valid_to < new Date().toISOString().slice(0, 10)
  return {
    planCode: row.plan_code,
    planName: row.name,
    status: expired ? "expired" : row.status,
    validTo: row.valid_to,
    limits,
    features,
  }
}

export async function requireFeature(client: PoolClient, siteId: number, feature: string, label: string) {
  const sub = await loadSubscription(client, siteId)
  if (sub.status !== "active") throw new HttpError(402, "Подписка SCADA EDI неактивна", "subscription_inactive")
  if (!sub.features[feature]) throw new HttpError(402, `${label} недоступно на тарифе «${sub.planName}»`, "plan_feature")
}

export type Usage = { documentsThisMonth: number; users: number; storageMb: number }

export async function loadUsage(client: PoolClient, siteId: number): Promise<Usage> {
  const r = await client.query<{ docs: number; users: number; bytes: string }>(
    `SELECT
       (SELECT count(*)::int FROM edi_documents WHERE site_id = $1 AND created_at >= date_trunc('month', now())) AS docs,
       (SELECT count(DISTINCT actor_user_id)::int FROM edi_events WHERE site_id = $1 AND action = 'auth.login'
          AND created_at >= now() - interval '30 days') AS users,
       (SELECT COALESCE(sum(size_bytes), 0)::text FROM edi_files WHERE site_id = $1) AS bytes`,
    [siteId]
  )
  const row = r.rows[0]
  return { documentsThisMonth: row.docs, users: row.users, storageMb: Math.round(Number(row.bytes) / 1024 / 1024) }
}

/** Проверка лимита перед созданием документа или загрузкой файла. */
export async function enforceLimits(client: PoolClient, siteId: number, add: { documents?: number; bytes?: number }) {
  const sub = await loadSubscription(client, siteId)
  if (sub.status !== "active") throw new HttpError(402, "Подписка SCADA EDI неактивна", "subscription_inactive")
  const usage = await loadUsage(client, siteId)
  const docLimit = sub.limits.documentsPerMonth
  if (add.documents && docLimit != null && usage.documentsThisMonth + add.documents > docLimit) {
    throw new HttpError(402, `Достигнут лимит тарифа: ${docLimit} документов в месяц`, "limit_documents")
  }
  const storageLimit = sub.limits.storageMb
  if (add.bytes && storageLimit != null && usage.storageMb + add.bytes / 1024 / 1024 > storageLimit) {
    throw new HttpError(402, `Достигнут лимит хранилища тарифа: ${storageLimit} МБ`, "limit_storage")
  }
}

export async function recordUsage(client: PoolClient, siteId: number, kind: string, documentId?: string | null, details?: Record<string, unknown>) {
  await client.query(
    `INSERT INTO edi_usage_events (site_id, kind, document_id, details) VALUES ($1, $2, $3::bigint, $4::jsonb)`,
    [siteId, kind, documentId ?? null, JSON.stringify(details ?? {})]
  )
}
