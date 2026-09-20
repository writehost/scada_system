/** Экранирует `%` `_` `\` в шаблоне ILIKE, чтобы поиск не становился маской. */
export function likeContains(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
  return `%${escaped}%`
}

export const LIKE_ESCAPE_SQL = "ESCAPE '\\'"
