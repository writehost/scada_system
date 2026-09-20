import type { PoolClient } from "pg"

export const SAAS_FEATURES = [
  "fg_plan",
  "fg_fleet",
  "fg_stock",
  "materials",
  "workshop",
  "virtual_warehouse",
  "production",
  "marking",
  "multi_warehouse",
  "analytics",
  "occupancy",
] as const

export type SaasFeature = (typeof SAAS_FEATURES)[number]

export type LicenseType = "trial" | "subscription" | "perpetual" | "expired"

export type PlanCode = "lite" | "standard" | "enterprise" | "custom"

/** Default feature sets by commercial plan */
export const PLAN_FEATURES: Record<PlanCode, Partial<Record<SaasFeature, boolean>>> = {
  lite: {
    fg_stock: true,
    materials: true,
    analytics: false,
    fg_plan: false,
    fg_fleet: false,
    workshop: false,
    virtual_warehouse: false,
    production: false,
    marking: false,
    multi_warehouse: false,
    occupancy: true,
  },
  standard: {
    fg_stock: true,
    materials: true,
    workshop: true,
    occupancy: true,
    analytics: true,
    production: true,
    marking: true,
    fg_plan: false,
    fg_fleet: false,
    virtual_warehouse: false,
    multi_warehouse: false,
  },
  enterprise: {
    fg_plan: true,
    fg_fleet: true,
    fg_stock: true,
    materials: true,
    workshop: true,
    virtual_warehouse: true,
    production: true,
    marking: true,
    multi_warehouse: true,
    analytics: true,
    occupancy: true,
  },
  custom: {},
}

export type SiteLicense = {
  siteId: number
  siteCode: string
  name: string
  isActive: boolean
  licenseType: LicenseType
  licenseExpiresAt: string | null
  planCode: PlanCode
  features: Partial<Record<SaasFeature, boolean>>
  maxUsers: number | null
  notes: string | null
}

function asLicenseType(v: unknown): LicenseType {
  const s = String(v || "").toLowerCase()
  if (s === "perpetual" || s === "subscription" || s === "trial" || s === "expired") return s
  return "trial"
}

function asPlan(v: unknown): PlanCode {
  const s = String(v || "").toLowerCase()
  if (s === "lite" || s === "standard" || s === "enterprise" || s === "custom") return s
  return "standard"
}

export function mergeFeatures(
  planCode: PlanCode,
  override: Record<string, unknown> | null | undefined
): Partial<Record<SaasFeature, boolean>> {
  const base = { ...(PLAN_FEATURES[planCode] || PLAN_FEATURES.standard) }
  if (override && typeof override === "object") {
    for (const key of SAAS_FEATURES) {
      if (key in override) base[key] = Boolean(override[key])
    }
  }
  return base
}

export function isLicenseValid(row: { licenseType: LicenseType; licenseExpiresAt: string | null; isActive: boolean }) {
  if (!row.isActive) return false
  if (row.licenseType === "expired") return false
  if (row.licenseType === "perpetual") return true
  if (!row.licenseExpiresAt) return row.licenseType === "trial" || row.licenseType === "subscription"
  const t = Date.parse(row.licenseExpiresAt)
  if (!Number.isFinite(t)) return true
  return t > Date.now()
}

export function siteHasFeature(site: SiteLicense, feature: SaasFeature): boolean {
  if (!isLicenseValid(site)) return false
  return Boolean(site.features[feature])
}

export async function loadSiteLicense(client: PoolClient, siteId: number): Promise<SiteLicense | null> {
  const r = await client.query(
    `SELECT site_id, site_code, name, is_active, license_type, license_expires_at, plan_code, features, max_users, notes
     FROM wms_sites WHERE site_id = $1`,
    [siteId]
  )
  const row = r.rows[0]
  if (!row) return null
  const planCode = asPlan(row.plan_code)
  return {
    siteId: Number(row.site_id),
    siteCode: String(row.site_code),
    name: String(row.name),
    isActive: Boolean(row.is_active),
    licenseType: asLicenseType(row.license_type),
    licenseExpiresAt: row.license_expires_at ? new Date(row.license_expires_at).toISOString() : null,
    planCode,
    features: mergeFeatures(planCode, row.features),
    maxUsers: row.max_users != null ? Number(row.max_users) : null,
    notes: row.notes != null ? String(row.notes) : null,
  }
}

export async function listSiteLicenses(client: PoolClient): Promise<SiteLicense[]> {
  const r = await client.query(
    `SELECT site_id, site_code, name, is_active, license_type, license_expires_at, plan_code, features, max_users, notes
     FROM wms_sites ORDER BY site_id`
  )
  return r.rows.map((row) => {
    const planCode = asPlan(row.plan_code)
    return {
      siteId: Number(row.site_id),
      siteCode: String(row.site_code),
      name: String(row.name),
      isActive: Boolean(row.is_active),
      licenseType: asLicenseType(row.license_type),
      licenseExpiresAt: row.license_expires_at ? new Date(row.license_expires_at).toISOString() : null,
      planCode,
      features: mergeFeatures(planCode, row.features),
      maxUsers: row.max_users != null ? Number(row.max_users) : null,
      notes: row.notes != null ? String(row.notes) : null,
    }
  })
}

export async function upsertSiteTenant(
  client: PoolClient,
  input: {
    siteCode: string
    name: string
    planCode?: PlanCode
    licenseType?: LicenseType
    licenseExpiresAt?: string | null
    features?: Partial<Record<SaasFeature, boolean>>
    maxUsers?: number | null
    isActive?: boolean
    notes?: string | null
  }
): Promise<SiteLicense> {
  const code = input.siteCode.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32)
  if (!code) throw new Error("укажите код организации")
  const planCode = input.planCode || "standard"
  const features = mergeFeatures(planCode, input.features || PLAN_FEATURES[planCode])
  const licenseType = input.licenseType || "trial"
  const name = input.name.trim().slice(0, 200) || code

  const existing = await client.query<{ site_id: number }>(
    `SELECT site_id FROM wms_sites WHERE lower(site_code) = lower($1) LIMIT 1`,
    [code]
  )

  let siteId: number
  if (existing.rows[0]) {
    siteId = Number(existing.rows[0].site_id)
    await client.query(
      `UPDATE wms_sites SET
         name = $2,
         is_active = COALESCE($3, true),
         license_type = $4,
         license_expires_at = $5::timestamptz,
         plan_code = $6,
         features = $7::jsonb,
         max_users = $8,
         notes = $9,
         updated_at = now()
       WHERE site_id = $1`,
      [
        siteId,
        name,
        input.isActive ?? true,
        licenseType,
        input.licenseExpiresAt || null,
        planCode,
        JSON.stringify(features),
        input.maxUsers ?? null,
        input.notes ?? null,
      ]
    )
  } else {
    const next = await client.query<{ n: string | number }>(
      `SELECT COALESCE(MAX(site_id), 0) + 1 AS n FROM wms_sites`
    )
    siteId = Number(next.rows[0]?.n || 1)
    await client.query(
      `INSERT INTO wms_sites (
         site_id, site_code, name, timezone, is_active, license_type, license_expires_at,
         plan_code, features, max_users, notes, updated_at
       ) VALUES (
         $1, $2, $3, 'Europe/Moscow', COALESCE($4, true), $5, $6::timestamptz,
         $7, $8::jsonb, $9, $10, now()
       )`,
      [
        siteId,
        code,
        name,
        input.isActive ?? true,
        licenseType,
        input.licenseExpiresAt || null,
        planCode,
        JSON.stringify(features),
        input.maxUsers ?? null,
        input.notes ?? null,
      ]
    )
  }

  const loaded = await loadSiteLicense(client, siteId)
  if (!loaded) throw new Error("не удалось сохранить организацию")
  return loaded
}
