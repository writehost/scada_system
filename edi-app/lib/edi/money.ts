/** Денежная арифметика в копейках, чтобы не накапливать ошибку float. */

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100
}

export function num(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s+/g, "").replace(",", "."))
  return Number.isFinite(n) ? n : null
}

/** «20%», «10%», «20/120», «без НДС», «5%»… → доля или null (без НДС). */
export function vatFraction(rate: string | null | undefined): number | null {
  const s = (rate || "").trim().toLowerCase()
  if (!s || s.includes("без")) return null
  const calc = /^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/.exec(s)
  if (calc) return Number(calc[1].replace(",", ".")) / 100
  const pct = /^(\d+(?:[.,]\d+)?)\s*%?$/.exec(s)
  if (pct) return Number(pct[1].replace(",", ".")) / 100
  return null
}

export const VAT_RATES = ["20%", "10%", "7%", "5%", "0%", "без НДС"]

export type LineInput = {
  qty?: unknown
  price?: unknown
  amountNet?: unknown
  vatRate?: string | null
  vatAmount?: unknown
  amountTotal?: unknown
}

/** Пересчёт строки: недостающие суммы вычисляются, заданные явно (из файла поставщика) сохраняются. */
export function computeLine(l: LineInput) {
  const qty = num(l.qty) ?? 0
  const price = num(l.price)
  const frac = vatFraction(l.vatRate)
  let net = num(l.amountNet)
  if (net == null && price != null) net = round2(qty * price)
  let vat = num(l.vatAmount)
  if (vat == null && net != null) vat = frac == null ? 0 : round2(net * frac)
  let total = num(l.amountTotal)
  if (total == null && net != null) total = round2(net + (vat ?? 0))
  return { qty, price, amountNet: net, vatAmount: vat, amountTotal: total }
}

export function sumLines(lines: Array<{ amountNet: number | null; vatAmount: number | null; amountTotal: number | null }>) {
  let net = 0
  let vat = 0
  let total = 0
  for (const l of lines) {
    net += l.amountNet ?? 0
    vat += l.vatAmount ?? 0
    total += l.amountTotal ?? 0
  }
  return { amountNet: round2(net), amountVat: round2(vat), amountTotal: round2(total) }
}

export function formatMoney(v: number | string | null | undefined, currency = "RUB"): string {
  const n = typeof v === "string" ? Number(v) : v
  if (n == null || !Number.isFinite(n)) return "—"
  const s = n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === "RUB" ? `${s} ₽` : `${s} ${currency}`
}
