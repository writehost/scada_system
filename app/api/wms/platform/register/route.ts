import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { upsertSiteTenant, PLAN_FEATURES, type PlanCode } from "@/lib/wms/saas-license"
import { createWmsUser } from "@/lib/wms/users-admin"
import { WmsHttpError } from "@/lib/wms/errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PLAN_PRICES: Record<string, number> = {
  lite: 15000,
  standard: 45000,
  enterprise: 0,
}

function normalizeCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32)
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const siteCode = normalizeCode(String(body.siteCode || ""))
  const name = String(body.orgName || body.name || "").trim().slice(0, 200)
  const planRaw = String(body.planCode || "lite").toLowerCase()
  const planCode = (["lite", "standard", "enterprise"].includes(planRaw) ? planRaw : "lite") as PlanCode
  const login = String(body.login || "").trim().toLowerCase().slice(0, 64)
  const password = String(body.password || "")
  const displayName = String(body.displayName || login).trim().slice(0, 120)
  const email = String(body.email || "").trim().slice(0, 200)

  if (!siteCode || siteCode.length < 2) {
    return NextResponse.json({ error: "Укажите код организации (латиница, от 2 символов)" }, { status: 400 })
  }
  if (!name || name.length < 2) {
    return NextResponse.json({ error: "Укажите название организации" }, { status: 400 })
  }
  if (!login || login.length < 2) {
    return NextResponse.json({ error: "Укажите логин администратора" }, { status: 400 })
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "Пароль не короче 6 символов" }, { status: 400 })
  }

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "сервис временно недоступен" }, { status: 503 })

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const exists = await client.query(
      `SELECT site_id FROM wms_sites WHERE lower(site_code) = lower($1) LIMIT 1`,
      [siteCode]
    )
    if (exists.rows.length > 0) {
      await client.query("ROLLBACK")
      return NextResponse.json(
        { error: "Организация с таким кодом уже есть. Выберите другой код — дубликаты запрещены." },
        { status: 409 }
      )
    }

    const nameDup = await client.query(
      `SELECT site_id FROM wms_sites WHERE lower(trim(name)) = lower(trim($1)) LIMIT 1`,
      [name]
    )
    if (nameDup.rows.length > 0) {
      await client.query("ROLLBACK")
      return NextResponse.json(
        { error: "Организация с таким названием уже зарегистрирована." },
        { status: 409 }
      )
    }

    // trial 14 days, features of selected plan — automatic activation
    const expires = new Date(Date.now() + 14 * 864e5).toISOString()
    const features = { ...PLAN_FEATURES[planCode] }

    const tenant = await upsertSiteTenant(client, {
      siteCode,
      name,
      planCode,
      licenseType: "trial",
      licenseExpiresAt: expires,
      features,
      isActive: true,
      notes: email ? `self-register email=${email}` : "self-register",
    })

    // admin user for this site
    try {
      await createWmsUser(client, tenant.siteId, {
        login,
        displayName: displayName || login,
        password,
        roleCodes: ["admin"],
      })
    } catch (e) {
      await client.query("ROLLBACK")
      if (e instanceof WmsHttpError) {
        return NextResponse.json({ error: e.message }, { status: e.status })
      }
      const msg = e instanceof Error ? e.message : "не удалось создать пользователя"
      if (/unique|duplicate|23505/i.test(msg)) {
        return NextResponse.json({ error: "Логин уже занят" }, { status: 409 })
      }
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    await client.query(
      `INSERT INTO wms_license_orders (site_id, site_code, plan_code, license_type, status, admin_login, contact_email, amount_rub, meta)
       VALUES ($1, $2, $3, 'trial', 'active', $4, $5, $6, $7::jsonb)`,
      [
        tenant.siteId,
        siteCode,
        planCode,
        login,
        email || null,
        PLAN_PRICES[planCode] ?? 0,
        JSON.stringify({ source: "self_service", trialDays: 14 }),
      ]
    )

    await client.query("COMMIT")

    return NextResponse.json({
      ok: true,
      siteCode: tenant.siteCode,
      planCode: tenant.planCode,
      licenseType: "trial",
      expiresAt: expires,
      login,
      message:
        "Организация создана. Пробный период 14 дней по выбранному тарифу. Войдите с указанным логином.",
      loginUrl: "/login",
    })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined)
    const msg = e instanceof Error ? e.message : "ошибка регистрации"
    if (/unique|duplicate|23505/i.test(msg)) {
      return NextResponse.json({ error: "Организация или логин уже существуют" }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
