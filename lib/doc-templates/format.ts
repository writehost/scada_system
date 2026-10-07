/** Форматирование значений — общее для backend-рендера и предпросмотра на холсте. */

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === "string" && value.trim()) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim())
    const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === "number") return new Date(value)
  return null
}

export function formatDate(value: unknown, fmt = "DD.MM.YYYY"): string {
  const d = toDate(value)
  if (!d) return value == null ? "" : String(value)
  const dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const get = dateOnly
    ? { y: d.getUTCFullYear(), mo: d.getUTCMonth(), day: d.getUTCDate(), h: 0, mi: 0 }
    : { y: d.getFullYear(), mo: d.getMonth(), day: d.getDate(), h: d.getHours(), mi: d.getMinutes() }
  const pad = (x: number) => String(x).padStart(2, "0")
  return fmt.replace(/YYYY|YY|MMMM|MM|DD|D|HH|mm/g, (tok) => {
    switch (tok) {
      case "YYYY":
        return String(get.y)
      case "YY":
        return String(get.y).slice(-2)
      case "MMMM":
        return MONTHS_GEN[get.mo]
      case "MM":
        return pad(get.mo + 1)
      case "DD":
        return pad(get.day)
      case "D":
        return String(get.day)
      case "HH":
        return pad(get.h)
      default:
        return pad(get.mi)
    }
  })
}

export function formatNumber(value: unknown, decimals?: number): string {
  if (value == null || value === "") return ""
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."))
  if (!Number.isFinite(n)) return String(value)
  const opts: Intl.NumberFormatOptions =
    decimals == null ? { maximumFractionDigits: 3 } : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
  return new Intl.NumberFormat("ru-RU", opts).format(n).replace(/ /g, " ")
}
