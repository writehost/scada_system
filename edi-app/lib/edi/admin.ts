import { randomBytes } from "node:crypto"
import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { requirePermission, type Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { isValidInn } from "./counterparties.ts"
import { DOC_TYPES } from "./doc-types.ts"
import { edoAvailable, PROVIDERS } from "./edo.ts"
import { listIntegrations, recordCheck, resolveIntegration, saveIntegration, type IntegrationKind } from "./integrations/config.ts"
import { WmsClient, WmsUnavailable } from "./integrations/wms.ts"
import { mailConfigured } from "./mailer.ts"
import { EDI_ROLES } from "./permissions.ts"
import { loadSubscription, loadUsage } from "./saas.ts"
import { encryptSecret } from "./secrets.ts"

/** Платформенные операции SaaS (тарифы, подписки, реестр форматов) — только операторам платформы. */
export function isPlatformAdmin(actor: Actor): boolean {
  const list = (process.env.EDI_PLATFORM_ADMINS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  return list.includes(actor.login.toLowerCase())
}

function requirePlatform(actor: Actor) {
  if (!isPlatformAdmin(actor)) throw new HttpError(403, "Доступно только оператору платформы SCADA EDI", "platform_only")
}

export async function getOrgSettings(client: PoolClient, actor: Actor) {
  const r = await client.query(
    `SELECT legal_name AS "legalName", inn, kpp, ogrn, address, bank_name AS "bankName", bank_bik AS "bankBik", bank_account AS "bankAccount",
            corr_account AS "corrAccount", phone, email, director, accountant, logo_file_id::text AS "logoFileId"
     FROM edi_org_settings WHERE site_id = $1`,
    [actor.siteId]
  )
  return r.rows[0] ?? { legalName: actor.orgName }
}

export async function saveOrgSettings(client: PoolClient, actor: Actor, b: Record<string, string | null>) {
  requirePermission(actor, "edi.admin")
  const inn = (b.inn ?? "").trim()
  if (inn && !isValidInn(inn)) throw new HttpError(400, "ИНН организации не прошёл проверку", "bad_inn")
  const t = (k: string, max = 500) => (typeof b[k] === "string" && b[k]!.trim() ? b[k]!.trim().slice(0, max) : null)
  await client.query(
    `INSERT INTO edi_org_settings (site_id, legal_name, inn, kpp, ogrn, address, bank_name, bank_bik, bank_account, corr_account, phone, email, director, accountant, logo_file_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::bigint)
     ON CONFLICT (site_id) DO UPDATE SET legal_name = $2, inn = $3, kpp = $4, ogrn = $5, address = $6, bank_name = $7, bank_bik = $8,
       bank_account = $9, corr_account = $10, phone = $11, email = $12, director = $13, accountant = $14,
       logo_file_id = COALESCE($15::bigint, edi_org_settings.logo_file_id), updated_at = now()`,
    [actor.siteId, t("legalName"), inn || null, t("kpp", 9), t("ogrn", 15), t("address", 1000), t("bankName"), t("bankBik", 9), t("bankAccount", 20), t("corrAccount", 20), t("phone"), t("email"), t("director"), t("accountant"), t("logoFileId", 20)]
  )
  await recordEvent(client, actorEvent(actor, "admin.settings", null, { section: "org" }))
  return getOrgSettings(client, actor)
}

export async function listOrgUsers(client: PoolClient, actor: Actor) {
  requirePermission(actor, "edi.admin")
  const r = await client.query(
    `SELECT u.user_id::text AS "userId", u.display_name AS name, u.login, u.is_active AS "isActive",
            COALESCE((SELECT array_agg(r.code) FROM wms_user_roles ur JOIN wms_roles r ON r.role_id = ur.role_id WHERE ur.user_id = u.user_id), '{}') AS "wmsRoles",
            COALESCE((SELECT array_agg(er.role_code) FROM edi_user_roles er WHERE er.user_id = u.user_id AND er.site_id = u.site_id), '{}') AS "ediRoles",
            (SELECT p.department FROM edi_user_profiles p WHERE p.user_id = u.user_id AND p.site_id = u.site_id) AS department
     FROM wms_users u WHERE u.site_id = $1 ORDER BY u.is_active DESC, u.display_name`,
    [actor.siteId]
  )
  return { users: r.rows, roles: Object.entries(EDI_ROLES).map(([code, r]) => ({ code, name: r.name, permissions: r.permissions })) }
}

/** Роли EDI пользователя (пустой список = роли по умолчанию от WMS). Пользователи не создаются здесь — только в SCADA ID / WMS. */
export async function setUserRoles(client: PoolClient, actor: Actor, b: { userId: string; roles: string[]; department?: string | null }) {
  requirePermission(actor, "edi.admin")
  const u = await client.query(`SELECT 1 FROM wms_users WHERE user_id = $1::bigint AND site_id = $2`, [b.userId, actor.siteId])
  if (!u.rows[0]) throw new HttpError(404, "Пользователь не найден", "not_found")
  const roles = (b.roles ?? []).filter((r) => EDI_ROLES[r])
  if (b.userId === actor.userId && !roles.includes("edi_admin") && roles.length > 0) throw new HttpError(400, "Нельзя снять с себя роль администратора", "self_demote")
  await client.query(`DELETE FROM edi_user_roles WHERE site_id = $1 AND user_id = $2::bigint`, [actor.siteId, b.userId])
  for (const r of roles) await client.query(`INSERT INTO edi_user_roles (site_id, user_id, role_code, granted_by) VALUES ($1, $2::bigint, $3, $4::bigint)`, [actor.siteId, b.userId, r, actor.userId])
  if (b.department !== undefined) {
    await client.query(
      `INSERT INTO edi_user_profiles (site_id, user_id, department) VALUES ($1, $2::bigint, $3)
       ON CONFLICT (site_id, user_id) DO UPDATE SET department = $3, updated_at = now()`,
      [actor.siteId, b.userId, b.department?.trim() || null]
    )
  }
  await recordEvent(client, actorEvent(actor, "admin.roles", null, { userId: b.userId, roles }))
  return { ok: true }
}

const INTEGRATION_CATALOG: Array<{ kind: IntegrationKind; provider: string; name: string; fields: Array<{ key: string; label: string }>; secretLabel: string; available: boolean; note: string }> = [
  { kind: "wms", provider: "scada-wms", name: "SCADA WMS", fields: [{ key: "baseUrl", label: "Адрес WMS (https://wms…)" }, { key: "siteCode", label: "Код площадки WMS (пусто — как у организации)" }], secretLabel: "Токен API пользователя WMS (wmsu_…)", available: true, note: "Номенклатура, алиасы, поставщики, заказы на приход, факт приёмки, уведомления SCADA" },
  { kind: "signature", provider: "verify-service", name: "Сервис проверки подписи", fields: [{ key: "verifyUrl", label: "URL проверки (POST JSON {signature, content})" }], secretLabel: "Bearer-токен сервиса", available: true, note: "Криптографическая проверка CAdES (ГОСТ), цепочки и отзыва. Ожидаемый ответ: {\"valid\": true|false, \"message\": …}" },
  { kind: "qpass", provider: "scada-qpass", name: "SCADA QPass", fields: [{ key: "baseUrl", label: "Адрес QPass" }], secretLabel: "Токен организации QPass", available: false, note: "Контракт QPass для документов ТО/ремонта пока не согласован: в WMS используется только паспорт оборудования" },
  { kind: "aps", provider: "scada-aps", name: "SCADA APS", fields: [], secretLabel: "", available: false, note: "Нет опубликованного API APS в этом репозитории" },
  { kind: "yms", provider: "scada-yms", name: "SCADA YMS", fields: [], secretLabel: "", available: false, note: "YMS хранит визиты в общей базе; API для документов рейса не опубликован" },
  { kind: "ems", provider: "scada-ems", name: "SCADA EMS", fields: [], secretLabel: "", available: false, note: "Контракт EMS не найден" },
  { kind: "edo", provider: "edo", name: "Оператор ЭДО", fields: [], secretLabel: "", available: PROVIDERS.length > 0, note: PROVIDERS.length ? "" : "Нет адаптера оператора, проверенного на официальном тестовом контуре" },
]

export async function integrationsView(client: PoolClient, actor: Actor) {
  requirePermission(actor, "edi.admin")
  const rows = await listIntegrations(client, actor.siteId)
  const wms = await resolveIntegration(client, actor.siteId, "wms")
  return {
    catalog: INTEGRATION_CATALOG,
    configured: rows,
    envWms: wms?.source === "env" ? { baseUrl: wms.config.baseUrl } : null,
    mail: mailConfigured(),
    edo: await edoAvailable(client, actor.siteId),
  }
}

export async function saveIntegrationSettings(client: PoolClient, actor: Actor, b: { kind: IntegrationKind; config: Record<string, string>; secret?: string; isEnabled: boolean }) {
  requirePermission(actor, "edi.admin")
  const cat = INTEGRATION_CATALOG.find((c) => c.kind === b.kind)
  if (!cat || !cat.available) throw new HttpError(400, "Эта интеграция недоступна", "integration_unavailable")
  const config: Record<string, string> = {}
  for (const f of cat.fields) {
    const v = String(b.config?.[f.key] ?? "").trim()
    if (f.key.toLowerCase().includes("url") && v) {
      let u: URL
      try {
        u = new URL(v)
      } catch {
        throw new HttpError(400, `${f.label}: некорректный адрес`, "bad_url")
      }
      if (!["https:", "http:"].includes(u.protocol)) throw new HttpError(400, `${f.label}: только http(s)`, "bad_url")
    }
    config[f.key] = v
  }
  const row = await saveIntegration(client, actor.siteId, actor.userId, { kind: b.kind, provider: cat.provider, name: cat.name, config, secret: b.secret, isEnabled: Boolean(b.isEnabled) })
  await recordEvent(client, actorEvent(actor, "admin.integration", null, { kind: b.kind, enabled: b.isEnabled }))
  return row
}

export async function checkIntegration(client: PoolClient, actor: Actor, kind: IntegrationKind) {
  requirePermission(actor, "edi.admin")
  const cfg = await resolveIntegration(client, actor.siteId, kind)
  if (!cfg) throw new HttpError(404, "Интеграция не настроена", "not_configured")
  let result: { ok: boolean; message: string; [k: string]: unknown }
  if (kind === "wms") {
    try {
      const c = new WmsClient({ baseUrl: String(cfg.config.baseUrl), token: cfg.secret, siteCode: String(cfg.config.siteCode || "") || actor.siteCode })
      result = await c.check()
    } catch (e) {
      result = { ok: false, message: e instanceof WmsUnavailable ? e.message : String(e) }
    }
  } else if (kind === "signature") {
    try {
      const res = await fetch(String(cfg.config.verifyUrl), { method: "OPTIONS", signal: AbortSignal.timeout(8000) })
      result = { ok: res.status < 500, message: `Сервис ответил ${res.status}` }
    } catch (e) {
      result = { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  } else {
    result = { ok: false, message: "Проверка для этого вида не реализована" }
  }
  await recordCheck(client, cfg.integrationId, result)
  return result
}

export async function subscriptionView(client: PoolClient, actor: Actor) {
  const [sub, usage, plans] = await Promise.all([
    loadSubscription(client, actor.siteId),
    loadUsage(client, actor.siteId),
    client.query(`SELECT plan_code AS code, name, limits, features, price_note AS "priceNote" FROM edi_plans ORDER BY sort_order`),
  ])
  const costs = await client.query(
    `SELECT kind, sum(quantity)::float8 AS qty FROM edi_usage_events WHERE site_id = $1 AND created_at >= date_trunc('month', now()) GROUP BY kind`,
    [actor.siteId]
  )
  return { subscription: sub, usage, plans: plans.rows, externalUsage: costs.rows, platformAdmin: isPlatformAdmin(actor) }
}

export async function setSubscription(client: PoolClient, actor: Actor, b: { siteId?: number; planCode: string; validTo?: string | null; customLimits?: Record<string, unknown>; status?: string }) {
  requirePlatform(actor)
  const siteId = b.siteId ?? actor.siteId
  await client.query(
    `INSERT INTO edi_subscriptions (site_id, plan_code, status, valid_to, custom_limits, updated_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6::bigint)
     ON CONFLICT (site_id) DO UPDATE SET plan_code = $2, status = $3, valid_to = $4, custom_limits = $5::jsonb, updated_by = $6::bigint, updated_at = now()`,
    [siteId, b.planCode, b.status === "suspended" ? "suspended" : "active", b.validTo || null, JSON.stringify(b.customLimits ?? {}), actor.userId]
  )
  await recordEvent(client, actorEvent(actor, "admin.settings", null, { section: "subscription", siteId, plan: b.planCode }))
  return { ok: true }
}

export async function savePlan(client: PoolClient, actor: Actor, b: { code: string; name: string; limits: Record<string, unknown>; features: Record<string, boolean>; priceNote?: string }) {
  requirePlatform(actor)
  await client.query(
    `INSERT INTO edi_plans (plan_code, name, limits, features, price_note) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (plan_code) DO UPDATE SET name = $2, limits = $3::jsonb, features = $4::jsonb, price_note = $5, updated_at = now()`,
    [b.code, b.name, JSON.stringify(b.limits), JSON.stringify(b.features), b.priceNote ?? null]
  )
  return { ok: true }
}

export async function formatsView(client: PoolClient) {
  const r = await client.query(`SELECT format_code AS code, name, doc_types AS "docTypes", knd, version, valid_from::text AS "validFrom", valid_to::text AS "validTo", legal_basis AS "legalBasis", note FROM edi_formats ORDER BY format_code`)
  return { formats: r.rows }
}

export async function saveFormat(client: PoolClient, actor: Actor, b: { code: string; validFrom?: string | null; validTo?: string | null; note?: string | null; legalBasis?: string | null }) {
  requirePlatform(actor)
  const r = await client.query(
    `UPDATE edi_formats SET valid_from = $2, valid_to = $3, note = COALESCE($4, note), legal_basis = COALESCE($5, legal_basis), updated_at = now() WHERE format_code = $1`,
    [b.code, b.validFrom || null, b.validTo || null, b.note ?? null, b.legalBasis ?? null]
  )
  if (!r.rowCount) throw new HttpError(404, "Формат не найден", "not_found")
  await recordEvent(client, actorEvent(actor, "admin.settings", null, { section: "format", code: b.code }))
  return { ok: true }
}

export async function auditView(client: PoolClient, actor: Actor, q: { action?: string; userId?: string; before?: string }) {
  requirePermission(actor, "edi.audit.read")
  const r = await client.query(
    `SELECT e.event_id::text AS id, e.action, e.actor_name AS "actorName", e.document_id::text AS "documentId", d.title, e.details, e.ip, e.created_at AS "createdAt"
     FROM edi_events e LEFT JOIN edi_documents d ON d.document_id = e.document_id
     WHERE e.site_id = $1 AND ($2::text = '' OR e.action LIKE $2 || '%') AND ($3::text = '' OR e.actor_user_id = NULLIF($3, '')::bigint)
       AND ($4::text = '' OR e.event_id < NULLIF($4, '')::bigint)
     ORDER BY e.event_id DESC LIMIT 200`,
    [actor.siteId, q.action ?? "", q.userId ?? "", q.before ?? ""]
  )
  return { events: r.rows }
}

export async function webhooksView(client: PoolClient, actor: Actor) {
  requirePermission(actor, "edi.admin")
  const r = await client.query(`SELECT webhook_id::text AS id, url, events, is_active AS "isActive", created_at AS "createdAt" FROM edi_webhooks WHERE site_id = $1 ORDER BY webhook_id`, [actor.siteId])
  const d = await client.query(
    `SELECT channel, status, count(*)::int AS n FROM edi_deliveries WHERE site_id = $1 AND created_at > now() - interval '7 days' GROUP BY channel, status`,
    [actor.siteId]
  )
  return { webhooks: r.rows, deliveries: d.rows }
}

export async function saveWebhook(client: PoolClient, actor: Actor, b: { id?: string; url?: string; events?: string[]; isActive?: boolean; delete?: boolean }) {
  requirePermission(actor, "edi.admin")
  if (b.delete && b.id) {
    await client.query(`DELETE FROM edi_webhooks WHERE webhook_id = $1::bigint AND site_id = $2`, [b.id, actor.siteId])
    return { ok: true }
  }
  if (b.id) {
    await client.query(`UPDATE edi_webhooks SET is_active = $3, events = $4 WHERE webhook_id = $1::bigint AND site_id = $2`, [b.id, actor.siteId, b.isActive !== false, b.events ?? []])
    return { ok: true }
  }
  let u: URL
  try {
    u = new URL(String(b.url))
  } catch {
    throw new HttpError(400, "Некорректный адрес", "bad_url")
  }
  if (u.protocol !== "https:" && process.env.NODE_ENV === "production") throw new HttpError(400, "Вебхук — только https", "bad_url")
  const secret = randomBytes(24).toString("base64url")
  const r = await client.query<{ id: string }>(
    `INSERT INTO edi_webhooks (site_id, url, secret_enc, events) VALUES ($1, $2, $3, $4) RETURNING webhook_id::text AS id`,
    [actor.siteId, u.toString(), encryptSecret(secret), b.events ?? []]
  )
  return { id: r.rows[0].id, secret, note: "Секрет показывается один раз: подпись X-EDI-Signature = HMAC-SHA256(secret, timestamp + '.' + body)" }
}

export async function retentionView(client: PoolClient, actor: Actor) {
  requirePermission(actor, "edi.admin")
  const rules = await client.query<{ doc_type: string; years: number; basis: string | null }>(`SELECT doc_type, years, basis FROM edi_retention_rules WHERE site_id = $1`, [actor.siteId])
  const byType = new Map(rules.rows.map((r) => [r.doc_type, r]))
  const types = DOC_TYPES.map((t) => ({ docType: t.code, name: t.name, years: byType.get(t.code)?.years ?? t.retentionYears, basis: byType.get(t.code)?.basis ?? t.retentionBasis, custom: byType.has(t.code) }))
  const expired = await client.query(
    `SELECT d.document_id::text AS "documentId", d.title, d.doc_type AS "docType", to_char(d.doc_date, 'YYYY-MM-DD') AS "docDate", d.archived_at AS "archivedAt"
     FROM edi_documents d LEFT JOIN edi_retention_rules r ON r.site_id = d.site_id AND r.doc_type = d.doc_type
     WHERE d.site_id = $1 AND d.deleted_at IS NULL AND d.archived_at IS NOT NULL AND d.doc_date IS NOT NULL
       AND make_date(extract(year FROM d.doc_date)::int + COALESCE(r.years, $2::int), 12, 31) < current_date
     ORDER BY d.doc_date LIMIT 500`,
    [actor.siteId, 5]
  )
  return { types, expired: expired.rows }
}

export async function saveRetention(client: PoolClient, actor: Actor, b: { docType: string; years: number; basis?: string }) {
  requirePermission(actor, "edi.admin")
  if (!DOC_TYPES.some((t) => t.code === b.docType)) throw new HttpError(400, "Неизвестный тип", "bad_type")
  if (!(b.years >= 1 && b.years <= 100)) throw new HttpError(400, "Срок от 1 до 100 лет", "bad_years")
  await client.query(
    `INSERT INTO edi_retention_rules (site_id, doc_type, years, basis) VALUES ($1, $2, $3, $4)
     ON CONFLICT (site_id, doc_type) DO UPDATE SET years = $3, basis = $4, updated_at = now()`,
    [actor.siteId, b.docType, Math.trunc(b.years), b.basis ?? null]
  )
  await recordEvent(client, actorEvent(actor, "admin.settings", null, { section: "retention", ...b }))
  return { ok: true }
}

/** Удаление по регламенту: только архивные документы с истёкшим сроком, по явному решению администратора. */
export async function purgeExpired(client: PoolClient, actor: Actor, ids: string[]) {
  requirePermission(actor, "edi.admin")
  const v = await retentionView(client, actor)
  const allowed = new Set(v.expired.map((e) => e.documentId))
  let n = 0
  for (const id of ids) {
    if (!allowed.has(id)) continue
    await client.query(`UPDATE edi_documents SET deleted_at = now() WHERE document_id = $1::bigint AND site_id = $2`, [id, actor.siteId])
    await recordEvent(client, actorEvent(actor, "document.deleted", id, { reason: "retention_expired" }))
    n++
  }
  return { deleted: n }
}
