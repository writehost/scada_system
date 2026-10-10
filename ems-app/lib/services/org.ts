// Пользователи и организации. Пользователь EMS — проекция пользователя SCADA ID
// (subject), отдельных паролей EMS не хранит.

import type { Db } from "../server/db.ts"
import { enterOrg } from "../server/db.ts"

export type Role = "owner" | "admin" | "engineer" | "accountant" | "viewer"

export const ROLES: Role[] = ["owner", "admin", "engineer", "accountant", "viewer"]

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  admin: "Администратор",
  engineer: "Инженер",
  accountant: "Бухгалтер",
  viewer: "Наблюдатель",
}

export type Permission =
  | "read"
  | "org.manage"
  | "users.manage"
  | "subscription.manage"
  | "sites.write"
  | "devices.write"
  | "readings.write"
  | "readings.correct"
  | "tariffs.write"
  | "finance.write"
  | "rules.write"
  | "events.ack"
  | "notifications.manage"
  | "integrations.manage"

const ALL: Permission[] = [
  "read", "org.manage", "users.manage", "subscription.manage", "sites.write", "devices.write", "readings.write", "readings.correct",
  "tariffs.write", "finance.write", "rules.write", "events.ack", "notifications.manage", "integrations.manage",
]

/** Раздельные права просмотра и администрирования приборов: viewer видит, engineer меняет. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== "subscription.manage"),
  engineer: ["read", "sites.write", "devices.write", "readings.write", "readings.correct", "rules.write", "events.ack", "notifications.manage"],
  accountant: ["read", "readings.write", "tariffs.write", "finance.write", "events.ack"],
  viewer: ["read"],
}

export function can(role: Role | null | undefined, perm: Permission): boolean {
  return Boolean(role && ROLE_PERMISSIONS[role]?.includes(perm))
}

export type OrgSummary = { orgId: string; name: string; kind: "personal" | "corporate"; segment: "home" | "industrial"; role: Role; isDemo: boolean; onboardingDone: boolean }

/** Системная область: список организаций пользователя для переключателя. */
export async function listUserOrgs(c: Db, userId: string): Promise<OrgSummary[]> {
  const r = await c.query(
    `SELECT o.org_id, o.name, o.kind, o.segment, m.role, o.is_demo, o.onboarding_done
       FROM ems_memberships m JOIN ems_organizations o ON o.org_id = m.org_id
      WHERE m.user_id = $1 AND o.archived_at IS NULL
      ORDER BY o.kind = 'personal' DESC, o.is_demo, o.name`,
    [userId],
  )
  return r.rows.map((x) => ({ orgId: x.org_id, name: x.name, kind: x.kind, segment: x.segment, role: x.role, isDemo: x.is_demo, onboardingDone: x.onboarding_done }))
}

export async function createOrganization(
  c: Db,
  input: { name: string; kind: "personal" | "corporate"; segment: "home" | "industrial"; ownerUserId: string; scadaOrgSlug?: string | null; isDemo?: boolean; ownerRole?: Role; source?: "owner" | "scada_id" },
): Promise<string> {
  const r = await c.query<{ org_id: string }>(
    `INSERT INTO ems_organizations (name, kind, segment, scada_org_slug, is_demo) VALUES ($1, $2, $3, $4, $5) RETURNING org_id`,
    [input.name, input.kind, input.segment, input.scadaOrgSlug ?? null, input.isDemo ?? false],
  )
  const orgId = r.rows[0].org_id
  await enterOrg(c, orgId)
  await c.query(`INSERT INTO ems_memberships (org_id, user_id, role, source) VALUES ($1, $2, $3, $4)`, [orgId, input.ownerUserId, input.ownerRole ?? "owner", input.source ?? "owner"])
  const plan = input.segment === "home" ? "home_trial" : "ind_trial"
  await c.query(
    `INSERT INTO ems_subscriptions (org_id, plan_code, status, trial_ends_at) VALUES ($1, $2, 'trial', now() + interval '30 days')`,
    [orgId, plan],
  )
  await c.query(`INSERT INTO ems_subscription_history (org_id, to_plan, to_status, actor_id, reason) VALUES ($1, $2, 'trial', $3, 'создание организации')`, [orgId, plan, input.ownerUserId])
  await c.query("SELECT set_config('ems.scope', 'system', true), set_config('ems.org_id', '', true)")
  return orgId
}

export type ScadaIdentity = { subject: string; email: string; name: string; isPlatformAdmin: boolean }

/** Создание или обновление пользователя по данным SCADA ID. Выполняется в системной области. */
export async function upsertUser(c: Db, id: ScadaIdentity): Promise<{ userId: string; personalOrgId: string | null }> {
  const r = await c.query<{ user_id: string; personal_org_id: string | null }>(
    `INSERT INTO ems_users (scada_subject, email, display_name, is_platform_admin, last_login_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (scada_subject) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name,
       is_platform_admin = EXCLUDED.is_platform_admin, last_login_at = now()
     RETURNING user_id, personal_org_id`,
    [id.subject, id.email || null, id.name, id.isPlatformAdmin],
  )
  return { userId: r.rows[0].user_id, personalOrgId: r.rows[0].personal_org_id }
}

export async function ensurePersonalOrg(c: Db, userId: string, displayName: string, existing: string | null): Promise<string> {
  if (existing) return existing
  const orgId = await createOrganization(c, { name: "Мой дом", kind: "personal", segment: "home", ownerUserId: userId })
  await c.query("UPDATE ems_users SET personal_org_id = $2 WHERE user_id = $1", [userId, orgId])
  void displayName
  return orgId
}

/** Корпоративная организация из SCADA ID: членство и роль синхронизируются при каждом входе. */
export async function syncCorporateMembership(c: Db, userId: string, org: { slug: string; name: string }, role: Role | null): Promise<string | null> {
  const found = await c.query<{ org_id: string }>("SELECT org_id FROM ems_organizations WHERE scada_org_slug = $1", [org.slug])
  let orgId = found.rows[0]?.org_id ?? null
  if (!role) {
    if (orgId) await c.query("DELETE FROM ems_memberships WHERE org_id = $1 AND user_id = $2 AND source = 'scada_id'", [orgId, userId])
    return null
  }
  if (!orgId) {
    orgId = await createOrganization(c, { name: org.name || org.slug, kind: "corporate", segment: "industrial", ownerUserId: userId, scadaOrgSlug: org.slug, ownerRole: role, source: "scada_id" })
    return orgId
  }
  await c.query(
    `INSERT INTO ems_memberships (org_id, user_id, role, source) VALUES ($1, $2, $3, 'scada_id')
     ON CONFLICT (org_id, user_id) DO UPDATE SET role = CASE WHEN ems_memberships.source = 'scada_id' THEN EXCLUDED.role ELSE ems_memberships.role END`,
    [orgId, userId, role],
  )
  await c.query("UPDATE ems_organizations SET name = $2 WHERE org_id = $1 AND name <> $2 AND $2 <> ''", [orgId, org.name])
  return orgId
}

/** Принятие приглашений по подтверждённому в SCADA ID email. */
export async function acceptInvitations(c: Db, userId: string, email: string): Promise<number> {
  if (!email) return 0
  const inv = await c.query<{ invitation_id: string; org_id: string; role: Role }>(
    `SELECT invitation_id, org_id, role FROM ems_invitations
      WHERE lower(email) = lower($1) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [email],
  )
  for (const i of inv.rows) {
    await c.query(`INSERT INTO ems_memberships (org_id, user_id, role, source) VALUES ($1, $2, $3, 'invite') ON CONFLICT (org_id, user_id) DO NOTHING`, [i.org_id, userId, i.role])
    await c.query("UPDATE ems_invitations SET accepted_at = now() WHERE invitation_id = $1", [i.invitation_id])
  }
  return inv.rowCount ?? 0
}

export async function membershipRole(c: Db, orgId: string, userId: string): Promise<Role | null> {
  const r = await c.query<{ role: Role }>("SELECT role FROM ems_memberships WHERE org_id = $1 AND user_id = $2", [orgId, userId])
  return r.rows[0]?.role ?? null
}
