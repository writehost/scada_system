/** Человекочитаемая подпись ячейки/короба по названию номенклатуры (для справки на складе). */

const MAX_LEN = 180

export function suggestLocationDisplayNameFromItemName(itemName: string, opts?: { label?: "box" | "cell" }): string {
  const name = itemName.trim()
  if (!name) return ""
  const label = opts?.label === "cell" ? "Ячейка" : "Короб"
  const base = `${label}: ${name}`
  return base.length <= MAX_LEN ? base : `${base.slice(0, MAX_LEN - 1)}…`
}
