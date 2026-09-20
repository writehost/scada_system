export function stripStickerNamePrefixes(name: string): string {
  let s = name.trim()
  while (/^стикеры?\s+/i.test(s)) {
    s = s.replace(/^стикеры?\s+/i, "").trim()
  }
  return s
}

export function withStickerNamePrefix(name: string): string {
  const base = stripStickerNamePrefixes(name) || name.trim()
  if (!base) return "Стикер"
  return `Стикер ${base}`
}
