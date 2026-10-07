import { formatDate, formatNumber } from "./format.ts"
import { getPath, parseVarExpr } from "./jinja/expressions.ts"

/**
 * Значения переменных для режима DATA PREVIEW на холсте.
 * Понимает путь и основные фильтры; всё остальное честно показывается как выражение —
 * точный результат даёт кнопка «Предпросмотр» (настоящий backend-рендер).
 */

export type PreviewScope = Record<string, unknown>

export type PreviewValue = { ok: true; text: string; raw: unknown } | { ok: false; text: string }

function applyFilter(value: unknown, name: string, args: string): unknown {
  const arg = args.trim().replace(/^["']|["']$/g, "")
  switch (name) {
    case "date":
      return formatDate(value, arg || "DD.MM.YYYY")
    case "number":
      return formatNumber(value, arg ? Number(arg) : undefined)
    case "money":
      return formatNumber(value, 2)
    case "default":
    case "d":
      return value == null || value === "" ? arg : value
    case "upper":
      return String(value ?? "").toUpperCase()
    case "lower":
      return String(value ?? "").toLowerCase()
    case "trim":
      return String(value ?? "").trim()
    case "length":
      return Array.isArray(value) ? value.length : String(value ?? "").length
    case "round":
      return Math.round(Number(value) * 10 ** (Number(arg) || 0)) / 10 ** (Number(arg) || 0)
    case "inn":
      return String(value ?? "").replace(/\D/g, "")
    default:
      return value
  }
}

export function evaluatePreview(expr: string, scope: PreviewScope): PreviewValue {
  const model = parseVarExpr(expr)
  if (!model) return { ok: false, text: expr }
  let value = getPath(scope, model.path)
  for (const f of model.filters) value = applyFilter(value, f.name, f.args)
  if (value == null) return { ok: true, text: "", raw: value }
  if (typeof value === "object") return { ok: true, text: Array.isArray(value) ? `[${value.length}]` : "{…}", raw: value }
  return { ok: true, text: String(value), raw: value }
}

/** Область видимости элемента цикла: первый элемент коллекции + loop.index. */
export function loopScope(scope: PreviewScope, itemVar: string, source: string, index = 0): { scope: PreviewScope; count: number } {
  const coll = getPath(scope, source)
  const list = Array.isArray(coll) ? coll : []
  return {
    scope: {
      ...scope,
      [itemVar]: list[index],
      loop: { index: index + 1, index0: index, first: index === 0, last: index === list.length - 1, length: list.length },
    },
    count: list.length,
  }
}
