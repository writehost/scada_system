// Первый запуск Home одной транзакцией: объект, услуги, тарифы, приборы (ручной ввод),
// платежи и адрес для уведомлений. Если что-то не так — не сохраняется ничего.
import { api } from "@/lib/server/http.ts"
import { badRequest } from "@/lib/server/errors.ts"
import { email, num, oneOf, reqStr, str } from "@/lib/server/validate.ts"
import { createMeter, createSite, SITE_KINDS, validateChannels } from "@/lib/services/assets.ts"
import { createAccount, createObligation, createTariff } from "@/lib/services/finance.ts"
import { addRecipient } from "@/lib/services/recipients.ts"
import { createRule } from "@/lib/services/rules.ts"
import { audit } from "@/lib/services/audit.ts"
import { addMonths, localDateKey, monthStartKey, daysInMonth, parseDateKey } from "@/lib/domain/time.ts"
import type { Service } from "@/lib/domain/tariffs.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TEMPLATES: Record<string, unknown[]> = {
  single: [{ code: "energy", name: "Активная энергия", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh", decimals: 1 }],
  two_zone: [
    { code: "energy_t1", name: "Т1 (день)", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh", tariff_zone: "T1", decimals: 1 },
    { code: "energy_t2", name: "Т2 (ночь)", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh", tariff_zone: "T2", decimals: 1 },
  ],
  water: [{ code: "volume", name: "Объём", quantity: "volume", measure_kind: "cumulative", unit: "m3", decimals: 3 }],
}

const RESOURCE: Partial<Record<Service, "electricity" | "cold_water" | "hot_water" | "gas">> = { electricity: "electricity", cold_water: "cold_water", hot_water: "hot_water", gas: "gas" }

function nextDue(today: string, day: number): string {
  const { year, month } = parseDateKey(today)
  const d = Math.min(day, daysInMonth(year, month))
  const candidate = `${today.slice(0, 8)}${String(d).padStart(2, "0")}`
  return candidate > today ? candidate : addMonths(monthStartKey(today), 1, day)
}

export const POST = api({ perm: "org.manage" }, async (ctx) =>
  ctx.tx(async (c) => {
    const site = (ctx.body.site ?? {}) as Record<string, unknown>
    const siteId = await createSite(c, ctx.orgId, ctx.actor, {
      name: reqStr(site, "name", "Название объекта", 120),
      kind: oneOf(site, "kind", "Тип объекта", SITE_KINDS),
      address: str(site, "address", "Адрес", { max: 300 }),
      timezone: str(site, "timezone", "Часовой пояс", { max: 60 }) ?? undefined,
    })
    const tz = str(site, "timezone", "Часовой пояс", { max: 60 }) || "Europe/Moscow"
    const today = localDateKey(Date.now(), tz)
    const services = Array.isArray(ctx.body.services) ? ctx.body.services : []
    if (!services.length) throw badRequest("Выберите хотя бы одну услугу")

    let recipientId: string | null = null
    const recipientEmail = email(ctx.body, "notifyEmail", "Email для уведомлений", false)
    if (recipientEmail) recipientId = await addRecipient(c, ctx.orgId, ctx.actor, { email: recipientEmail, label: "Основной" })

    for (const raw of services) {
      const s = (raw ?? {}) as Record<string, unknown>
      const service = oneOf(s, "service", "Услуга", ["electricity", "cold_water", "hot_water", "wastewater", "heating", "gas", "internet", "other"] as const)
      const resource = RESOURCE[service]
      const hasMeter = resource != null && s.meter != null
      const calcMethod = hasMeter || (service === "wastewater" && s.tariff) ? "meter" : s.fixedAmount != null && s.fixedAmount !== "" ? "fixed" : "manual"
      const accountId = await createAccount(c, ctx.orgId, ctx.actor, { siteId, service, providerName: str(s, "providerName", "Поставщик", { max: 120 }), accountNumber: str(s, "accountNumber", "Лицевой счёт", { max: 60 }), calcMethod })
      const label = str(s, "title", "Название", { max: 120 }) ?? ({ electricity: "Электричество", cold_water: "Холодная вода", hot_water: "Горячая вода", wastewater: "Водоотведение", heating: "Отопление", gas: "Газ", internet: "Интернет", other: "Услуга" } as Record<string, string>)[service]
      const validFrom = monthStartKey(addMonths(today, -1, 1))
      if (calcMethod === "fixed") {
        await createTariff(c, ctx.orgId, ctx.actor, { accountId, name: label, kind: "fixed", validFrom, config: { amount: num(s, "fixedAmount", `${label}: сумма`, { min: 0 }) } })
      } else if (s.tariff) {
        const t = s.tariff as Record<string, unknown>
        await createTariff(c, ctx.orgId, ctx.actor, { accountId, name: str(t, "name", "Название тарифа", { max: 120 }) || label, kind: reqStr(t, "kind", "Вид тарифа", 20), validFrom, config: t.config, sourceNote: "указан при первом запуске" })
      }
      if (hasMeter) {
        const m = s.meter as Record<string, unknown>
        const template = oneOf(m, "template", "Тип счётчика", ["single", "two_zone", "water"] as const, resource === "electricity" ? "single" : "water")
        await createMeter(c, ctx.orgId, ctx.actor, {
          siteId, resource, name: str(m, "name", "Название счётчика", { max: 120 }) || `Счётчик: ${label.toLowerCase()}`,
          serialNumber: str(m, "serialNumber", "Заводской номер", { max: 60 }), connection: "manual", channels: validateChannels(TEMPLATES[template], "manual"),
          initialReadings: Object.fromEntries(Object.entries((m.initialReadings ?? {}) as Record<string, unknown>).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, Number(String(v).replace(",", "."))])),
        })
        if (resource === "cold_water" || resource === "hot_water") {
          await createRule(c, ctx.orgId, ctx.actor, { kind: "consumption_growth", siteId, params: { resource, thresholdPct: 35 } })
        }
      }
      const dueDay = num(s, "dueDay", `${label}: день оплаты`, { min: 1, max: 31, integer: true })
      if (dueDay) {
        const due = nextDue(today, dueDay)
        const readingsDay = num(s, "readingsDay", `${label}: день передачи показаний`, { min: 1, max: 31, integer: true })
        await createObligation(c, ctx.orgId, ctx.actor, {
          siteId, accountId, title: label, service, providerName: str(s, "providerName", "Поставщик", { max: 120 }), accountNumber: str(s, "accountNumber", "Лицевой счёт", { max: 60 }),
          amountMode: calcMethod === "fixed" ? "fixed" : calcMethod === "meter" ? "calculated" : "manual",
          amount: calcMethod === "fixed" ? num(s, "fixedAmount", "Сумма", { min: 0 }) : null,
          dueDate: due, readingsDueDate: readingsDay && readingsDay <= dueDay ? `${due.slice(0, 8)}${String(readingsDay).padStart(2, "0")}` : null,
          recurrence: { freq: "monthly", interval: 1, day: dueDay }, remindDays: num(s, "remindDays", "Напомнить за", { min: 0, max: 30, integer: true }) ?? 3,
          recipientIds: recipientId ? [recipientId] : [],
        })
      }
    }
    await c.query("UPDATE ems_organizations SET onboarding_done = true, segment = 'home' WHERE org_id = $1", [ctx.orgId])
    await audit(c, ctx.orgId, ctx.actor, "onboarding.home", { type: "site", id: siteId }, { services: services.length })
    return { siteId }
  }),
)
