// Расчётный модуль. Работает только с количествами и тарифами и ничего не знает
// о том, откуда пришли показания. Цены всегда задаёт пользователь или администратор:
// встроенных «актуальных» тарифов нет.

import { inClockRange, localParts, parseClock, weekdayOfKey } from "./time.ts"

export type Service = "electricity" | "cold_water" | "hot_water" | "wastewater" | "heating" | "gas" | "internet" | "other"

export const SERVICES: Service[] = ["electricity", "cold_water", "hot_water", "wastewater", "heating", "gas", "internet", "other"]

export const SERVICE_LABELS: Record<Service, string> = {
  electricity: "Электроэнергия",
  cold_water: "Холодная вода",
  hot_water: "Горячая вода",
  wastewater: "Водоотведение",
  heating: "Отопление",
  gas: "Газ",
  internet: "Интернет",
  other: "Прочее",
}

export const SERVICE_UNITS: Partial<Record<Service, string>> = {
  electricity: "kWh",
  cold_water: "m3",
  hot_water: "m3",
  wastewater: "m3",
  heating: "Gcal",
  gas: "m3",
}

export type ClockRange = { from: string; to: string }
export type Zone = { code: string; name: string; price: number; ranges: ClockRange[] }

export type CapacityComponent =
  | { basis: "declared"; declaredKw: number; pricePerKw: number }
  | { basis: "peak_hours"; pricePerKw: number; ranges: ClockRange[]; workdaysOnly: boolean; aggregate: "avg_of_daily_max" | "max" }

export type Extra = { label: string; amount: number }

export type TariffConfig =
  | { kind: "single"; price: number; extras?: Extra[]; capacity?: CapacityComponent }
  | { kind: "zones"; zones: Zone[]; extras?: Extra[]; capacity?: CapacityComponent }
  | { kind: "hot_water"; mode: "one_component"; price: number; extras?: Extra[] }
  | { kind: "hot_water"; mode: "two_component"; coldPrice: number; heatPerM3: number; heatPrice: number; extras?: Extra[] }
  | { kind: "wastewater"; price: number; basis: "cold_plus_hot" | "own_meter"; extras?: Extra[] }
  | { kind: "fixed"; amount: number }

export type Tariff = {
  tariffId: string
  name: string
  validFrom: string
  validTo: string | null
  config: TariffConfig
}

export type DayUsage = { day: string; qty: number; allocated: number }
export type HourUsage = { ts: number; qty: number; allocated: number }

export type UsageInput = {
  tz: string
  /** Суточные количества по основной величине услуги. */
  days: DayUsage[]
  /** Почасовые данные (для зон по времени суток и мощности). */
  hours?: HourUsage[]
  /** Показания по зонам из регистров прибора (Т1/Т2/Т3) по суткам. */
  zoneDays?: Record<string, DayUsage[]>
}

export type CostLine = {
  label: string
  qty: number | null
  unit: string | null
  price: number | null
  amount: number
  tariffId: string
  fixed: boolean
  estimated: boolean
}

export type CostResult = {
  amount: number | null
  variableAmount: number
  fixedAmount: number
  qty: number
  allocatedQty: number
  lines: CostLine[]
  warnings: string[]
}

export class TariffValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TariffValidationError"
  }
}

function num(v: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v)
  if (!Number.isFinite(n)) throw new TariffValidationError(`Поле «${field}»: нужно число`)
  if (opts.min != null && n < opts.min) throw new TariffValidationError(`Поле «${field}»: не меньше ${opts.min}`)
  if (opts.max != null && n > opts.max) throw new TariffValidationError(`Поле «${field}»: не больше ${opts.max}`)
  return n
}

function ranges(v: unknown, field: string): ClockRange[] {
  if (!Array.isArray(v) || v.length === 0) throw new TariffValidationError(`${field}: укажите интервалы времени`)
  return v.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    const from = String(o.from ?? "")
    const to = String(o.to ?? "")
    try {
      parseClock(from)
      parseClock(to)
    } catch {
      throw new TariffValidationError(`${field}: время в формате ЧЧ:ММ`)
    }
    return { from, to }
  })
}

function extras(v: unknown): Extra[] | undefined {
  if (v == null) return undefined
  if (!Array.isArray(v)) throw new TariffValidationError("Дополнительные начисления: нужен список")
  return v.map((e, i) => {
    const o = (e ?? {}) as Record<string, unknown>
    const label = String(o.label ?? "").trim()
    if (!label) throw new TariffValidationError(`Дополнительное начисление ${i + 1}: укажите название`)
    return { label: label.slice(0, 120), amount: num(o.amount, label, { min: 0, max: 1e9 }) }
  })
}

function capacity(v: unknown): CapacityComponent | undefined {
  if (v == null) return undefined
  const o = v as Record<string, unknown>
  if (o.basis === "declared") {
    return { basis: "declared", declaredKw: num(o.declaredKw, "Заявленная мощность", { min: 0 }), pricePerKw: num(o.pricePerKw, "Ставка за мощность", { min: 0 }) }
  }
  if (o.basis === "peak_hours") {
    return {
      basis: "peak_hours",
      pricePerKw: num(o.pricePerKw, "Ставка за мощность", { min: 0 }),
      ranges: ranges(o.ranges, "Часы пиковой нагрузки"),
      workdaysOnly: o.workdaysOnly !== false,
      aggregate: o.aggregate === "max" ? "max" : "avg_of_daily_max",
    }
  }
  throw new TariffValidationError("Мощность: выберите способ расчёта")
}

/** Проверка и нормализация конфигурации тарифа из запроса. */
export function parseTariffConfig(kind: string, raw: unknown): TariffConfig {
  const o = (raw ?? {}) as Record<string, unknown>
  const priceOpts = { min: 0, max: 1e7 }
  switch (kind) {
    case "single":
      return { kind, price: num(o.price, "Цена за единицу", priceOpts), extras: extras(o.extras), capacity: capacity(o.capacity) }
    case "zones": {
      if (!Array.isArray(o.zones) || o.zones.length < 2 || o.zones.length > 4) {
        throw new TariffValidationError("Многозонный тариф: от 2 до 4 зон")
      }
      const zones = o.zones.map((z, i) => {
        const zo = (z ?? {}) as Record<string, unknown>
        const code = String(zo.code ?? `T${i + 1}`).trim().toUpperCase()
        if (!/^T[1-4]$/.test(code)) throw new TariffValidationError("Код зоны: T1…T4")
        return { code, name: String(zo.name ?? code).trim().slice(0, 40) || code, price: num(zo.price, `Цена зоны ${code}`, priceOpts), ranges: ranges(zo.ranges, `Зона ${code}`) }
      })
      if (new Set(zones.map((z) => z.code)).size !== zones.length) throw new TariffValidationError("Коды зон повторяются")
      assertZonesCoverDay(zones)
      return { kind, zones, extras: extras(o.extras), capacity: capacity(o.capacity) }
    }
    case "hot_water":
      if (o.mode === "two_component") {
        return {
          kind,
          mode: "two_component",
          coldPrice: num(o.coldPrice, "Компонент на холодную воду, ₽/м³", priceOpts),
          heatPerM3: num(o.heatPerM3, "Норматив тепла, Гкал/м³", { min: 0, max: 1 }),
          heatPrice: num(o.heatPrice, "Компонент на тепловую энергию, ₽/Гкал", priceOpts),
          extras: extras(o.extras),
        }
      }
      return { kind, mode: "one_component", price: num(o.price, "Цена, ₽/м³", priceOpts), extras: extras(o.extras) }
    case "wastewater":
      return { kind, price: num(o.price, "Цена, ₽/м³", priceOpts), basis: o.basis === "own_meter" ? "own_meter" : "cold_plus_hot", extras: extras(o.extras) }
    case "fixed":
      return { kind, amount: num(o.amount, "Сумма в месяц", { min: 0, max: 1e9 }) }
    default:
      throw new TariffValidationError("Неизвестный вид тарифа")
  }
}

/** Зоны должны покрывать сутки без пересечений — иначе часть энергии не попадёт ни в одну зону. */
export function assertZonesCoverDay(zones: Zone[]): void {
  for (let minute = 0; minute < 1440; minute += 30) {
    const hits = zones.filter((z) => z.ranges.some((r) => inClockRange(minute, parseClock(r.from), parseClock(r.to))))
    if (hits.length === 0) throw new TariffValidationError(`Зоны не покрывают время ${String(Math.floor(minute / 60)).padStart(2, "0")}:${minute % 60 === 0 ? "00" : "30"}`)
    if (hits.length > 1) throw new TariffValidationError(`Зоны ${hits.map((z) => z.code).join(" и ")} пересекаются`)
  }
}

export function zoneOfMinute(zones: Zone[], minuteOfDay: number): Zone | null {
  return zones.find((z) => z.ranges.some((r) => inClockRange(minuteOfDay, parseClock(r.from), parseClock(r.to)))) ?? null
}

export function tariffForDay(tariffs: Tariff[], day: string): Tariff | null {
  let best: Tariff | null = null
  for (const t of tariffs) {
    if (t.validFrom <= day && (t.validTo == null || t.validTo >= day)) {
      if (!best || t.validFrom > best.validFrom) best = t
    }
  }
  return best
}

const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * Стоимость за период. Дни группируются по действовавшему тарифу; если на
 * какой-то день тарифа нет, сумма не считается (amount = null) — с понятным
 * предупреждением, а не нулём.
 */
export function calculateCost(service: Service, tariffs: Tariff[], usage: UsageInput, unit: string | null = SERVICE_UNITS[service] ?? null): CostResult {
  const warnings: string[] = []
  const lines: CostLine[] = []
  const byTariff = new Map<string, { tariff: Tariff; days: DayUsage[] }>()
  let missing = 0
  for (const d of usage.days) {
    const t = tariffForDay(tariffs, d.day)
    if (!t) {
      if (d.qty > 0) missing += 1
      continue
    }
    const g = byTariff.get(t.tariffId) ?? { tariff: t, days: [] }
    g.days.push(d)
    byTariff.set(t.tariffId, g)
  }
  const qty = usage.days.reduce((s, d) => s + d.qty, 0)
  const allocatedQty = usage.days.reduce((s, d) => s + d.allocated, 0)
  if (missing > 0) warnings.push(`Нет тарифа на ${missing} дн. с потреблением — укажите тариф, действовавший в эти дни`)

  // Фиксированные платежи берутся по одному разу за месяц, по тарифу первого дня периода в этом месяце.
  const monthsSeen = new Set<string>()
  let incomplete = missing > 0

  for (const { tariff, days } of byTariff.values()) {
    const cfg = tariff.config
    const groupQty = days.reduce((s, d) => s + d.qty, 0)
    const groupAlloc = days.reduce((s, d) => s + d.allocated, 0)
    const estimated = groupAlloc > 0
    const months = new Set(days.map((d) => d.day.slice(0, 7)))
    const newMonths = [...months].filter((m) => !monthsSeen.has(m))
    newMonths.forEach((m) => monthsSeen.add(m))

    switch (cfg.kind) {
      case "single":
        lines.push({ label: tariff.name, qty: groupQty, unit, price: cfg.price, amount: round2(groupQty * cfg.price), tariffId: tariff.tariffId, fixed: false, estimated })
        break
      case "zones": {
        const split = splitZones(cfg.zones, days, usage)
        if (!split) {
          warnings.push("Для зонного тарифа нужны показания по зонам (Т1/Т2) или почасовые данные прибора")
          incomplete = true
          break
        }
        for (const z of cfg.zones) {
          const q = split.byZone[z.code] ?? 0
          lines.push({ label: `${tariff.name}: ${z.name}`, qty: q, unit, price: z.price, amount: round2(q * z.price), tariffId: tariff.tariffId, fixed: false, estimated: estimated || split.estimated })
        }
        if (split.estimated) warnings.push("Разделение по зонам частично оценочное: часть расхода распределена между редкими показаниями")
        break
      }
      case "hot_water":
        if (cfg.mode === "one_component") {
          lines.push({ label: tariff.name, qty: groupQty, unit, price: cfg.price, amount: round2(groupQty * cfg.price), tariffId: tariff.tariffId, fixed: false, estimated })
        } else {
          lines.push({ label: "ГВС: компонент на холодную воду", qty: groupQty, unit, price: cfg.coldPrice, amount: round2(groupQty * cfg.coldPrice), tariffId: tariff.tariffId, fixed: false, estimated })
          const heat = groupQty * cfg.heatPerM3
          lines.push({ label: "ГВС: компонент на тепловую энергию", qty: heat, unit: "Gcal", price: cfg.heatPrice, amount: round2(heat * cfg.heatPrice), tariffId: tariff.tariffId, fixed: false, estimated })
        }
        break
      case "wastewater":
        lines.push({ label: tariff.name, qty: groupQty, unit, price: cfg.price, amount: round2(groupQty * cfg.price), tariffId: tariff.tariffId, fixed: false, estimated })
        break
      case "fixed":
        for (const m of newMonths) {
          lines.push({ label: `${tariff.name} (${m})`, qty: null, unit: null, price: null, amount: round2(cfg.amount), tariffId: tariff.tariffId, fixed: true, estimated: false })
        }
        break
    }

    if ("extras" in cfg && cfg.extras) {
      for (const m of newMonths) {
        for (const e of cfg.extras) {
          lines.push({ label: `${e.label} (${m})`, qty: null, unit: null, price: null, amount: round2(e.amount), tariffId: tariff.tariffId, fixed: true, estimated: false })
        }
      }
    }
    if ((cfg.kind === "single" || cfg.kind === "zones") && cfg.capacity) {
      const cap = capacityCharge(cfg.capacity, days, usage)
      for (const m of newMonths) {
        if (cap.kw == null) {
          warnings.push("Для расчёта мощности по часам пиковой нагрузки нужны почасовые данные")
          incomplete = true
          break
        }
        lines.push({ label: `Мощность (${m})`, qty: cap.kw, unit: "kW", price: cfg.capacity.pricePerKw, amount: round2(cap.kw * cfg.capacity.pricePerKw), tariffId: tariff.tariffId, fixed: true, estimated: cap.estimated })
      }
    }
  }

  const variableAmount = round2(lines.filter((l) => !l.fixed).reduce((s, l) => s + l.amount, 0))
  const fixedAmount = round2(lines.filter((l) => l.fixed).reduce((s, l) => s + l.amount, 0))
  if (byTariff.size === 0 && qty > 0) incomplete = true
  return {
    amount: incomplete ? null : round2(variableAmount + fixedAmount),
    variableAmount,
    fixedAmount,
    qty,
    allocatedQty,
    lines,
    warnings,
  }
}

function splitZones(zones: Zone[], days: DayUsage[], usage: UsageInput): { byZone: Record<string, number>; estimated: boolean } | null {
  const daySet = new Set(days.map((d) => d.day))
  const zoneDays = usage.zoneDays
  if (zoneDays && zones.every((z) => zoneDays[z.code])) {
    // Регистры прибора дают точное разделение по зонам; распределение между
    // редкими показаниями по дням уже учтено признаком estimated группы дней.
    const byZone: Record<string, number> = {}
    for (const z of zones) {
      byZone[z.code] = (zoneDays[z.code] ?? []).filter((d) => daySet.has(d.day)).reduce((s, d) => s + d.qty, 0)
    }
    return { byZone, estimated: false }
  }
  if (!usage.hours) return null
  const byZone: Record<string, number> = {}
  let estimated = false
  let covered = 0
  for (const h of usage.hours) {
    const p = localParts(h.ts, usage.tz)
    const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
    if (!daySet.has(key)) continue
    const z = zoneOfMinute(zones, p.hour * 60 + p.minute)
    if (!z) continue
    byZone[z.code] = (byZone[z.code] ?? 0) + h.qty
    covered += h.qty
    if (h.allocated > 0) estimated = true
  }
  const dayTotal = days.reduce((s, d) => s + d.qty, 0)
  if (dayTotal > 0 && covered <= 0) return null
  return { byZone, estimated }
}

function capacityCharge(cap: CapacityComponent, days: DayUsage[], usage: UsageInput): { kw: number | null; estimated: boolean } {
  if (cap.basis === "declared") return { kw: cap.declaredKw, estimated: false }
  if (!usage.hours) return { kw: null, estimated: false }
  const daySet = new Set(days.map((d) => d.day))
  const maxByDay = new Map<string, number>()
  let estimated = false
  for (const h of usage.hours) {
    const p = localParts(h.ts, usage.tz)
    const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
    if (!daySet.has(key)) continue
    if (cap.workdaysOnly && weekdayOfKey(key) >= 6) continue
    const minute = p.hour * 60
    if (!cap.ranges.some((r) => inClockRange(minute, parseClock(r.from), parseClock(r.to)))) continue
    if (h.allocated > 0) estimated = true
    // кВт·ч за час = средняя мощность за этот час, кВт
    maxByDay.set(key, Math.max(maxByDay.get(key) ?? 0, h.qty))
  }
  if (maxByDay.size === 0) return { kw: null, estimated }
  const values = [...maxByDay.values()]
  const kw = cap.aggregate === "max" ? Math.max(...values) : values.reduce((s, v) => s + v, 0) / values.length
  return { kw: Math.round(kw * 1000) / 1000, estimated }
}
