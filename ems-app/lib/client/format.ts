// Форматирование чисел, денег, дат и единиц для интерфейса.

export const UNIT: Record<string, string> = { kWh: "кВт·ч", kW: "кВт", W: "Вт", m3: "м³", "m3/h": "м³/ч", L: "л", Gcal: "Гкал", RUB: "₽", pulse: "имп." }

export function unit(u: string | null | undefined): string {
  return u ? UNIT[u] ?? u : ""
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export function qty(v: number | null | undefined, u: string | null | undefined, digits?: number): string {
  if (v == null) return "—"
  const d = digits ?? (u === "m3" ? 3 : u === "kWh" || u === "kW" ? 1 : 2)
  return `${num(v, d)} ${unit(u)}`.trim()
}

export function rub(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return `${v.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits })} ₽`
}

export function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—"
  const r = Math.round(v)
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}%`
}

export function dateRu(v: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" }): string {
  if (!v) return "—"
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("ru-RU", { ...opts, timeZone: typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? "UTC" : undefined })
}

export function dateTimeRu(v: string | Date | null | undefined): string {
  if (!v) return "—"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function relative(v: string | Date | null | undefined): string {
  if (!v) return "никогда"
  const diff = Date.now() - new Date(v).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return "только что"
  if (min < 60) return `${min} мин назад`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.round(h / 24)
  if (d < 31) return `${d} дн. назад`
  return dateRu(v)
}

export function monthName(key: string): string {
  const d = new Date(`${key.slice(0, 7)}-15T12:00:00Z`)
  const s = d.toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
  return s.charAt(0).toUpperCase() + s.slice(1).replace(" г.", "")
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function localInputValue(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export const RESOURCE_LABEL: Record<string, string> = { electricity: "Электричество", cold_water: "Холодная вода", hot_water: "Горячая вода", heat: "Тепло", gas: "Газ", leak: "Датчик протечки", other: "Прочее" }
export const SERVICE_LABEL: Record<string, string> = { electricity: "Электроэнергия", cold_water: "Холодная вода", hot_water: "Горячая вода", wastewater: "Водоотведение", heating: "Отопление", gas: "Газ", internet: "Интернет", other: "Прочее" }
export const BASIS_LABEL: Record<string, string> = { actual: "по квитанции", calculated: "расчёт по показаниям", forecast: "прогноз", fixed: "фиксированная сумма", manual: "вручную", paid: "оплачено" }
export const SITE_KIND_LABEL: Record<string, string> = { apartment: "Квартира", house: "Дом", garage: "Гараж", office: "Офис", workshop: "Мастерская", plant: "Завод", warehouse: "Склад", commercial: "Коммерческое здание", utility: "Инженерный объект", other: "Другое" }
