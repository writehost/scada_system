// Завершение входа: по ответу SCADA ID создаёт/обновляет пользователя,
// синхронизирует членство в организациях и выдаёт сессию EMS.

import { withSystem } from "./db.ts"
import { HttpError } from "./errors.ts"
import { emsRoleFromScada, identity, resolvePermissions, scadaIdConfig, userInfo, type ScadaIdConfig, type ScadaIdPermissions } from "./scada-id.ts"
import { createSession } from "./session.ts"
import { acceptInvitations, ensurePersonalOrg, listUserOrgs, syncCorporateMembership, upsertUser } from "../services/org.ts"
import { audit } from "../services/audit.ts"

export type LoginResult = { token: string; expiresAt: Date; userId: string; activeOrgId: string | null }

export async function completeLogin(
  accessToken: string,
  opts: { kind: "web" | "mobile"; userAgent?: string | null; ip?: string | null; cfg?: ScadaIdConfig },
): Promise<LoginResult> {
  const cfg = opts.cfg ?? scadaIdConfig()
  const info = await userInfo(cfg, accessToken)
  if (!info) throw new HttpError(401, "scada_id_token_invalid", "SCADA ID не подтвердил токен входа")
  const perms: ScadaIdPermissions | null = await resolvePermissions(cfg, accessToken).catch(() => null)
  const id = identity(info, perms)
  if (!id.subject) throw new HttpError(401, "scada_id_no_subject", "SCADA ID не вернул идентификатор пользователя")
  const role = perms ? emsRoleFromScada(perms, cfg.application) : null
  const corporate = perms?.organization?.slug ? perms.organization : null
  if (!cfg.allowPersonal && !(corporate && role)) {
    throw new HttpError(403, "no_access", `${id.email || "Пользователь"} не имеет доступа к SCADA EMS. Доступ выдаётся администратором в SCADA ID.`)
  }

  return withSystem(async (c) => {
    const { userId, personalOrgId } = await upsertUser(c, { subject: id.subject, email: id.email, name: id.name, isPlatformAdmin: Boolean(perms?.is_god || perms?.is_super_admin) })
    let corporateOrgId: string | null = null
    if (corporate) corporateOrgId = await syncCorporateMembership(c, userId, { slug: corporate.slug, name: corporate.name }, role)
    if (cfg.allowPersonal) await ensurePersonalOrg(c, userId, id.name, personalOrgId)
    await acceptInvitations(c, userId, id.email)
    const orgs = await listUserOrgs(c, userId)
    if (!orgs.length) throw new HttpError(403, "no_access", "Нет доступных организаций SCADA EMS")
    const last = await c.query<{ active_org_id: string | null }>(
      "SELECT active_org_id FROM ems_sessions WHERE user_id = $1 AND active_org_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      [userId],
    )
    const preferred = last.rows[0]?.active_org_id
    const activeOrgId = (preferred && orgs.some((o) => o.orgId === preferred) ? preferred : null) ?? corporateOrgId ?? orgs[0].orgId
    const s = await createSession(c, { userId, activeOrgId, kind: opts.kind, userAgent: opts.userAgent, ip: opts.ip })
    await audit(c, activeOrgId, { kind: "user", id: userId, ip: opts.ip }, opts.kind === "mobile" ? "auth.mobile_login" : "auth.login", { type: "session", id: s.sessionId }, { via: "scada_id" })
    return { token: s.token, expiresAt: s.expiresAt, userId, activeOrgId }
  })
}

/**
 * Вход для разработки без SCADA ID. Работает только при EMS_DEV_LOGIN=1 и
 * вне production-сборки; в интерфейсе помечен как режим разработчика.
 */
export function devLoginEnabled(): boolean {
  return process.env.EMS_DEV_LOGIN === "1" && (process.env.NODE_ENV !== "production" || process.env.EMS_DEV_LOGIN_UNSAFE_PRODUCTION === "1")
}

export async function devLogin(input: { email: string; name: string; segment: "home" | "industrial"; ip?: string | null }): Promise<LoginResult> {
  if (!devLoginEnabled()) throw new HttpError(404, "not_found", "Not found")
  return withSystem(async (c) => {
    const subject = `dev:${input.email}`
    const { userId, personalOrgId } = await upsertUser(c, { subject, email: input.email, name: input.name, isPlatformAdmin: input.email.startsWith("admin@") })
    if (input.segment === "industrial") {
      await syncCorporateMembership(c, userId, { slug: `dev-${input.email.split("@")[1] ?? "corp"}`, name: "Завод (разработка)" }, "admin")
    }
    await ensurePersonalOrg(c, userId, input.name, personalOrgId)
    await acceptInvitations(c, userId, input.email)
    const orgs = await listUserOrgs(c, userId)
    const active = input.segment === "industrial" ? orgs.find((o) => o.kind === "corporate")?.orgId ?? orgs[0].orgId : orgs[0].orgId
    const s = await createSession(c, { userId, activeOrgId: active, kind: "web", ip: input.ip })
    await audit(c, active, { kind: "user", id: userId, ip: input.ip }, "auth.dev_login")
    return { token: s.token, expiresAt: s.expiresAt, userId, activeOrgId: active }
  })
}
