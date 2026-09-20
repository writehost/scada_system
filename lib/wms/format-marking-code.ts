/** Полный GS1-код для отображения: SSCC или 01+GTIN+21+serial. */
export function formatGs1MarkingCode(
  gtin: string,
  serial: string,
  ai93?: Buffer | string | null
): string {
  const GS = "\x1d"
  const g = gtin.trim()
  const s = serial.trim()
  if (!g) return s

  if (/^00/.test(g) || (g.startsWith("003") && g.length >= 14)) {
    return `${g}${s}`
  }

  let out = `01${g}21${s}`
  if (ai93) {
    const tail = typeof ai93 === "string" ? ai93 : ai93.toString("latin1")
    if (tail) out += `${GS}93${tail}`
  }
  return out
}
