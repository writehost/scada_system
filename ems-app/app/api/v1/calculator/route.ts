// Калькулятор без сохранения: стоимость по введённому количеству и тарифу.
import { api } from "@/lib/server/http.ts"
import { badRequest } from "@/lib/server/errors.ts"
import { num, oneOf } from "@/lib/server/validate.ts"
import { calculateCost, parseTariffConfig, SERVICES, TariffValidationError } from "@/lib/domain/tariffs.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "read" }, async (ctx) => {
  const service = oneOf(ctx.body, "service", "Услуга", SERVICES)
  const kind = oneOf(ctx.body, "kind", "Вид тарифа", ["single", "zones", "hot_water", "wastewater", "fixed"] as const)
  let config
  try {
    config = parseTariffConfig(kind, ctx.body.config)
  } catch (e) {
    if (e instanceof TariffValidationError) throw badRequest(e.message)
    throw e
  }
  const day = "2000-01-01"
  const tariff = { tariffId: "calc", name: "Тариф", validFrom: day, validTo: null, config }
  if (kind === "zones") {
    const zq = (ctx.body.zoneQty ?? {}) as Record<string, unknown>
    const zoneDays: Record<string, Array<{ day: string; qty: number; allocated: number }>> = {}
    let total = 0
    for (const z of (config as { zones: Array<{ code: string }> }).zones) {
      const q = Number(String(zq[z.code] ?? "0").replace(",", "."))
      if (!Number.isFinite(q) || q < 0) throw badRequest(`Количество в зоне ${z.code}: неотрицательное число`)
      zoneDays[z.code] = [{ day, qty: q, allocated: 0 }]
      total += q
    }
    return calculateCost(service, [tariff], { tz: "UTC", days: [{ day, qty: total, allocated: 0 }], zoneDays })
  }
  const qty = num(ctx.body, "qty", "Количество", { min: 0, max: 1e12 }) ?? 0
  return calculateCost(service, [tariff], { tz: "UTC", days: [{ day, qty, allocated: 0 }] })
})
