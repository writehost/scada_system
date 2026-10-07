/**
 * Простые Jinja-выражения ↔ структурированные модели для визуальных редакторов.
 * Всё, что не укладывается в модель, остаётся строкой и правится в Advanced-режиме —
 * исходное выражение при этом не меняется.
 */

const PATH_RE = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[\d+\])*$/
const IDENT_RE = /^[A-Za-z_]\w*$/

export function isSimplePath(value: string): boolean {
  return PATH_RE.test(value.trim())
}

export type VarFilter = { name: string; args: string }
export type VarModel = { path: string; filters: VarFilter[] }

/** Разбивает строку по разделителю верхнего уровня (вне кавычек и скобок). */
function splitTopLevel(src: string, sep: RegExp): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let last = 0
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === "\\") i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === "(" || ch === "[") depth++
    else if (ch === ")" || ch === "]") depth--
    else if (depth === 0) {
      sep.lastIndex = i
      const m = sep.exec(src)
      if (m && m.index === i) {
        out.push(src.slice(last, i))
        last = i + m[0].length
        i = last - 1
      }
    }
  }
  out.push(src.slice(last))
  return out
}

export function parseVarExpr(expr: string): VarModel | null {
  const parts = splitTopLevel(expr.trim(), /\|/y).map((p) => p.trim())
  const path = parts[0]
  if (!isSimplePath(path)) return null
  const filters: VarFilter[] = []
  for (const f of parts.slice(1)) {
    const m = /^([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\))?$/.exec(f)
    if (!m) return null
    filters.push({ name: m[1], args: (m[2] ?? "").trim() })
  }
  return { path, filters }
}

export function buildVarExpr(model: VarModel): string {
  const filters = model.filters.map((f) => (f.args ? ` | ${f.name}(${f.args})` : ` | ${f.name}`)).join("")
  return `${model.path}${filters}`
}

export type CondOp = "eq" | "ne" | "gt" | "lt" | "ge" | "le" | "contains" | "exists" | "not_exists"
export type CondOperand = { kind: "literal"; value: string | number | boolean | null } | { kind: "path"; value: string }
export type CondRule = { left: string; op: CondOp; right?: CondOperand }
export type CondModel = { join: "and" | "or"; rules: CondRule[] }

export const COND_OPS: { id: CondOp; label: string; unary?: boolean }[] = [
  { id: "eq", label: "равно" },
  { id: "ne", label: "не равно" },
  { id: "gt", label: "больше" },
  { id: "lt", label: "меньше" },
  { id: "ge", label: "больше или равно" },
  { id: "le", label: "меньше или равно" },
  { id: "contains", label: "содержит" },
  { id: "exists", label: "заполнено", unary: true },
  { id: "not_exists", label: "не заполнено", unary: true },
]

const OP_TO_JINJA: Record<string, string> = { eq: "==", ne: "!=", gt: ">", lt: "<", ge: ">=", le: "<=" }
const JINJA_TO_OP: Record<string, CondOp> = { "==": "eq", "!=": "ne", ">": "gt", "<": "lt", ">=": "ge", "<=": "le" }

function parseLiteral(src: string): CondOperand | null {
  const s = src.trim()
  if (/^"(?:[^"\\]|\\.)*"$/.test(s) || /^'(?:[^'\\]|\\.)*'$/.test(s)) {
    return { kind: "literal", value: s.slice(1, -1).replace(/\\(.)/g, "$1") }
  }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return { kind: "literal", value: Number(s) }
  if (s === "true" || s === "True") return { kind: "literal", value: true }
  if (s === "false" || s === "False") return { kind: "literal", value: false }
  if (s === "none" || s === "None" || s === "null") return { kind: "literal", value: null }
  if (isSimplePath(s)) return { kind: "path", value: s }
  return null
}

function literalToJinja(op: CondOperand): string {
  if (op.kind === "path") return op.value
  const v = op.value
  if (v === null) return "none"
  if (typeof v === "boolean") return v ? "true" : "false"
  if (typeof v === "number") return String(v)
  return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function parensWrapWhole(s: string): boolean {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === "\\") i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === "(") depth++
    else if (ch === ")") {
      depth--
      if (depth === 0 && i < s.length - 1) return false
    }
  }
  return depth === 0
}

function parseRule(src: string): CondRule | null {
  let s = src.trim()
  while (s.startsWith("(") && s.endsWith(")") && parensWrapWhole(s)) s = s.slice(1, -1).trim()
  let m = /^not\s+([\s\S]+)$/.exec(s)
  if (m && isSimplePath(m[1])) return { left: m[1].trim(), op: "not_exists" }
  m = /^([\s\S]+?)\s+is\s+(not\s+)?defined$/.exec(s)
  if (m && isSimplePath(m[1])) return { left: m[1].trim(), op: m[2] ? "not_exists" : "exists" }
  if (isSimplePath(s)) return { left: s, op: "exists" }
  m = /^([\s\S]+?)\s+in\s+([A-Za-z_][\w.]*)$/.exec(s)
  if (m && isSimplePath(m[2])) {
    const lit = parseLiteral(m[1])
    if (lit && lit.kind === "literal") return { left: m[2], op: "contains", right: lit }
  }
  m = /^([A-Za-z_][\w.[\]]*)\s*(==|!=|>=|<=|>|<)\s*([\s\S]+)$/.exec(s)
  if (m && isSimplePath(m[1])) {
    const right = parseLiteral(m[3])
    if (right) return { left: m[1], op: JINJA_TO_OP[m[2]], right }
  }
  return null
}

export function parseCondition(src: string): CondModel | null {
  const s = src.trim()
  if (!s) return { join: "and", rules: [] }
  const ors = splitTopLevel(s, /\s+or\s+/y)
  const ands = splitTopLevel(s, /\s+and\s+/y)
  if (ors.length > 1 && ands.length > 1) return null
  const join: "and" | "or" = ors.length > 1 ? "or" : "and"
  const parts = join === "or" ? ors : ands
  const rules: CondRule[] = []
  for (const p of parts) {
    const r = parseRule(p)
    if (!r) return null
    rules.push(r)
  }
  return { join, rules }
}

export function buildRule(rule: CondRule): string {
  if (rule.op === "exists") return rule.left
  if (rule.op === "not_exists") return `not ${rule.left}`
  const right = rule.right ?? { kind: "literal", value: "" }
  if (rule.op === "contains") return `${literalToJinja(right)} in ${rule.left}`
  return `${rule.left} ${OP_TO_JINJA[rule.op]} ${literalToJinja(right)}`
}

export function buildCondition(model: CondModel): string {
  const parts = model.rules.filter((r) => r.left.trim()).map(buildRule)
  return parts.join(` ${model.join} `)
}

export type LoopModel = { itemVar: string; source: string }

export function parseLoopHeader(src: string): LoopModel | null {
  const m = /^([A-Za-z_]\w*)\s+in\s+([\s\S]+)$/.exec(src.trim())
  if (!m || !IDENT_RE.test(m[1]) || !isSimplePath(m[2])) return null
  return { itemVar: m[1], source: m[2].trim() }
}

export function buildLoopHeader(model: LoopModel): string {
  return `${model.itemVar} in ${model.source}`
}

/** Вычисление простого условия на данных предпросмотра (для режима DATA PREVIEW). */
export function getPath(data: unknown, path: string): unknown {
  let cur: unknown = data
  for (const part of path.replace(/\[(\d+)\]/g, ".$1").split(".")) {
    if (cur == null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  return !!v
}

export function evaluateCondition(src: string, data: unknown): boolean | null {
  const model = parseCondition(src)
  if (!model) return null
  if (!model.rules.length) return true
  const results = model.rules.map((r) => {
    const left = getPath(data, r.left)
    const right = r.right ? (r.right.kind === "path" ? getPath(data, r.right.value) : r.right.value) : undefined
    switch (r.op) {
      case "exists":
        return truthy(left)
      case "not_exists":
        return !truthy(left)
      case "eq":
        return left == right
      case "ne":
        return left != right
      case "gt":
        return Number(left) > Number(right)
      case "lt":
        return Number(left) < Number(right)
      case "ge":
        return Number(left) >= Number(right)
      case "le":
        return Number(left) <= Number(right)
      case "contains":
        if (typeof left === "string") return left.includes(String(right))
        if (Array.isArray(left)) return left.includes(right)
        return false
    }
    return false
  })
  return model.join === "and" ? results.every(Boolean) : results.some(Boolean)
}
