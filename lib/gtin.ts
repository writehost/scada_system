/**
 * В БД `ai01_gtin` — CHAR(14). Без ведущих нулей точное совпадение в SearchCodes не срабатывает.
 */
export function parseGtinFilterOrThrow(input: string): string | undefined {
  const t = input.trim();
  if (!t) return undefined;
  const d = t.replace(/\D/g, "");
  if (d.length === 0) return undefined;
  if (d.length > 14) {
    throw new Error("GTIN: не более 14 цифр");
  }
  return d.padStart(14, "0");
}
