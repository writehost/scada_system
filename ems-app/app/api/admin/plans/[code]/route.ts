import { NextResponse } from "next/server"
import { errorResponse } from "@/lib/server/http.ts"
import { requirePlatformAdmin } from "@/lib/server/admin.ts"
import { withSystem } from "@/lib/server/db.ts"
import { badRequest, notFound } from "@/lib/server/errors.ts"
import { LIMIT_LABELS } from "@/lib/domain/plans.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Цены и лимиты тарифов SCADA EMS меняются здесь, а не в коде. */
export async function PATCH(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    const admin = await requirePlatformAdmin(req)
    const { code } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const price = body.priceMonth === null || body.priceMonth === "" ? null : body.priceMonth === undefined ? undefined : Number(body.priceMonth)
    if (price !== undefined && price !== null && !(price >= 0)) throw badRequest("Цена — неотрицательное число или пусто (по договору)")
    let limits: Record<string, number | null> | undefined
    if (body.limits !== undefined) {
      if (!body.limits || typeof body.limits !== "object") throw badRequest("Лимиты: объект")
      limits = {}
      for (const k of Object.keys(LIMIT_LABELS)) {
        const v = (body.limits as Record<string, unknown>)[k]
        if (v === null || v === "" || v === undefined) limits[k] = null
        else if (Number.isFinite(Number(v)) && Number(v) >= 0) limits[k] = Number(v)
        else throw badRequest(`Лимит ${k}: число`)
      }
    }
    await withSystem(async (c) => {
      const r = await c.query(
        `UPDATE ems_plans SET name = COALESCE($2, name), description = COALESCE($3, description), price_month = CASE WHEN $4::boolean THEN $5 ELSE price_month END,
                limits = COALESCE($6::jsonb, limits), is_public = COALESCE($7, is_public), updated_at = now(), updated_by = $8 WHERE plan_code = $1 RETURNING plan_code`,
        [code, typeof body.name === "string" ? body.name.slice(0, 80) : null, typeof body.description === "string" ? body.description.slice(0, 300) : null, price !== undefined, price ?? null, limits ? JSON.stringify(limits) : null, typeof body.isPublic === "boolean" ? body.isPublic : null, admin.userId],
      )
      if (!r.rows[0]) throw notFound("Тариф")
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
