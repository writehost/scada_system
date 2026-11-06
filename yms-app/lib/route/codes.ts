/**
 * Разбор отсканированных кодов: GS1 SSCC (AI 00), HU WMS, адрес хранения (QR/DataMatrix ячейки).
 * Чистые функции, без БД.
 */

const GS = "\u001d"

/** Убираем префикс символики (]C1, ]d2, ]Q3), FNC1, скобки AI и пробелы. */
export function compactScan(raw: string): string {
  let v = (raw ?? "").trim()
  v = v.replace(/^\][A-Za-z]\d/, "")
  v = v.split(GS).join("")
  v = v.replace(/\s+/g, "")
  return v
}

/** Контрольная цифра GS1 (mod 10) для 17 первых цифр SSCC. */
export function gs1CheckDigit(digits17: string): number {
  let sum = 0
  for (let i = 0; i < digits17.length; i += 1) {
    const d = Number(digits17[digits17.length - 1 - i])
    sum += i % 2 === 0 ? d * 3 : d
  }
  return (10 - (sum % 10)) % 10
}

export type SsccParse = { ok: true; sscc18: string; full: string; checkOk: boolean } | { ok: false }

/** (00)123456789012345678 / 00123456789012345678 / ]C100123... → SSCC из 18 цифр. */
export function parseSscc(raw: string): SsccParse {
  const v = compactScan(raw).replace(/^\(00\)/, "00")
  const m = v.match(/^00(\d{18})$/)
  if (!m) return { ok: false }
  const sscc18 = m[1]
  const checkOk = gs1CheckDigit(sscc18.slice(0, 17)) === Number(sscc18[17])
  return { ok: true, sscc18, full: `00${sscc18}`, checkOk }
}

/** Код адреса из QR ячейки: https://wms…/s/c/FG-A-32 или просто FG-A-32 / A-32. */
export function parseAddressScan(raw: string): string | null {
  const v = (raw ?? "").trim()
  if (!v) return null
  const url = v.match(/\/s\/c\/([^/?#]+)/i)
  let code = url ? decodeURIComponent(url[1]) : v
  code = code.trim().toUpperCase().replace(/\s+/g, "")
  if (!code) return null
  if (/^[A-ZА-ЯЁ]-\d+/.test(code)) code = `FG-${code}`
  return code
}

export type ScanKind = "sscc" | "hu" | "address"

export type ClassifiedScan =
  | { kind: "sscc"; value: string; checkOk: boolean }
  | { kind: "address"; value: string }
  | { kind: "hu"; value: string }
  | { kind: "unknown"; value: string }

/** Что отсканировали. Палета: SSCC или HU WMS. Адрес: URL ячейки или FG-…/LINE-… */
export function classifyScan(raw: string): ClassifiedScan {
  const sscc = parseSscc(raw)
  if (sscc.ok) return { kind: "sscc", value: sscc.full, checkOk: sscc.checkOk }
  const v = compactScan(raw)
  if (/\/s\/c\//i.test(v) || /^FG-[A-ZА-ЯЁ]/i.test(v)) {
    const addr = parseAddressScan(v)
    if (addr) return { kind: "address", value: addr }
  }
  if (/^[A-Za-z0-9._:/-]{4,64}$/.test(v)) return { kind: "hu", value: v.toUpperCase() }
  return { kind: "unknown", value: v }
}

/** Код палеты в виде, в котором его сравниваем с заданием. */
export function palletKey(raw: string | null | undefined): string {
  if (!raw) return ""
  const sscc = parseSscc(raw)
  if (sscc.ok) return sscc.full
  return compactScan(raw).toUpperCase()
}
