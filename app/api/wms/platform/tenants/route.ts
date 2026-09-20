import { NextResponse } from "next/server"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { tryGetPool } from "@/lib/wms/pool"
import {
  listSiteLicenses,
  upsertSiteTenant,
  type LicenseType,
  type PlanCode,
  type SaasFeature,
  SAAS_FEATURES,
} from "@/lib/wms/saas-license"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isPlatformAdmin(actor: { session: { roleCodes?: string[] } | null }) {
  const roles = actor.session?.roleCodes || []
  return roles.includes("admin")
}

export async function GET(req: Request) {
  const actorGate = await requireWmsActor(req)
  if ("error" in actorGate) return actorGate.error
  if (!isPlatformAdmin(actorGate.actor)) {
    return NextResponse.json({ error: "только администратор платформы" }, { status: 403 })
  }
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "нет БД" }, { status: 503 })
  const client = await pool.connect()
  try {
    const tenants = await listSiteLicenses(client)
    return NextResponse.json({ tenants, features: SAAS_FEATURES })
  } finally {
    client.release()
  }
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req)
  if ("error" in actorGate) return actorGate.error
  if (!isPlatformAdmin(actorGate.actor)) {
    return NextResponse.json({ error: "только администратор платформы" }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "нет БД" }, { status: 503 })
  const client = await pool.connect()
  try {
    const featuresRaw = body.features
    const features: Partial<Record<SaasFeature, boolean>> | undefined =
      featuresRaw && typeof featuresRaw === "object"
        ? (featuresRaw as Partial<Record<SaasFeature, boolean>>)
        : undefined
    const tenant = await upsertSiteTenant(client, {
      siteCode: String(body.siteCode || ""),
      name: String(body.name || ""),
      planCode: (body.planCode as PlanCode) || "standard",
      licenseType: (body.licenseType as LicenseType) || "trial",
      licenseExpiresAt: body.licenseExpiresAt != null ? String(body.licenseExpiresAt) : null,
      features,
      maxUsers: body.maxUsers != null ? Number(body.maxUsers) : null,
      isActive: body.isActive !== false,
      notes: body.notes != null ? String(body.notes) : null,
    })
    return NextResponse.json({ tenant }, { status: 201 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "не удалось сохранить" },
      { status: 400 }
    )
  } finally {
    client.release()
  }
}
