/**
 * Сканер HTML со вставками Jinja.
 *
 * Не строит DOM: только плоский список токенов с позициями в исходнике,
 * чтобы импортёр мог при сомнении вернуть исходный фрагмент байт-в-байт.
 * Jinja внутри значений атрибутов остаётся частью атрибута.
 */

export type HtmlAttr = {
  name: string
  /** Значение как в исходнике, без кавычек и без декодирования сущностей. null — атрибут без значения. */
  value: string | null
}

export type TagToken = {
  kind: "open" | "close"
  name: string
  attrs: HtmlAttr[]
  selfClosing: boolean
  /** Jinja стоит между атрибутами, а не внутри значения — такой тег нельзя разобрать безопасно. */
  jinjaOutsideValues: boolean
  start: number
  end: number
}

export type TextToken = { kind: "text"; start: number; end: number }
export type CommentToken = { kind: "comment" | "doctype"; start: number; end: number }
export type JinjaExprToken = { kind: "jexpr"; body: string; trimLeft: boolean; trimRight: boolean; start: number; end: number }
export type JinjaStmtToken = {
  kind: "jstmt"
  /** Первое слово: if, elif, else, endif, for, endfor, set, … */
  keyword: string
  /** Остаток после ключевого слова. */
  args: string
  trimLeft: boolean
  trimRight: boolean
  start: number
  end: number
}
export type JinjaCommentToken = { kind: "jcomment"; start: number; end: number }
/** `{% raw %}…{% endraw %}` и содержимое <script>/<style> — одним куском. */
export type RawBlockToken = { kind: "jrawblock"; start: number; end: number }

export type Token =
  | TagToken
  | TextToken
  | CommentToken
  | JinjaExprToken
  | JinjaStmtToken
  | JinjaCommentToken
  | RawBlockToken

export const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
])

const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"])

function findJinjaEnd(src: string, from: number, close: string): number {
  // Строковые литералы внутри Jinja могут содержать закрывающую последовательность.
  let i = from
  let quote: string | null = null
  while (i < src.length) {
    const ch = src[i]
    if (quote) {
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      i++
      continue
    }
    if (src.startsWith(close, i)) return i
    i++
  }
  return -1
}

function readJinja(src: string, i: number): Token | null {
  const open = src.slice(i, i + 2)
  if (open === "{#") {
    const end = src.indexOf("#}", i + 2)
    if (end < 0) return null
    return { kind: "jcomment", start: i, end: end + 2 }
  }
  if (open !== "{{" && open !== "{%") return null
  const close = open === "{{" ? "}}" : "%}"
  const endAt = findJinjaEnd(src, i + 2, close)
  if (endAt < 0) return null
  let inner = src.slice(i + 2, endAt)
  let trimLeft = false
  let trimRight = false
  if (inner.startsWith("-") || inner.startsWith("+")) {
    trimLeft = inner.startsWith("-")
    inner = inner.slice(1)
  }
  if (inner.endsWith("-") || inner.endsWith("+")) {
    trimRight = inner.endsWith("-")
    inner = inner.slice(0, -1)
  }
  const end = endAt + 2
  if (open === "{{") {
    return { kind: "jexpr", body: inner.trim(), trimLeft, trimRight, start: i, end }
  }
  const body = inner.trim()
  const m = /^([A-Za-z_][\w]*)\s*([\s\S]*)$/.exec(body)
  const keyword = m ? m[1] : ""
  const args = m ? m[2].trim() : body
  if (keyword === "raw") {
    const re = /\{%-?\s*endraw\s*-?%\}/g
    re.lastIndex = end
    const found = re.exec(src)
    if (found) return { kind: "jrawblock", start: i, end: found.index + found[0].length }
  }
  return { kind: "jstmt", keyword, args, trimLeft, trimRight, start: i, end }
}

function skipJinjaInTag(src: string, i: number): number {
  const t = readJinja(src, i)
  return t ? t.end : i + 2
}

function readTag(src: string, i: number): TagToken | null {
  const isClose = src[i + 1] === "/"
  let p = i + (isClose ? 2 : 1)
  const nameMatch = /^[A-Za-z][\w:-]*/.exec(src.slice(p, p + 64))
  if (!nameMatch) return null
  const name = nameMatch[0].toLowerCase()
  p += nameMatch[0].length
  const attrs: HtmlAttr[] = []
  let jinjaOutsideValues = false
  let selfClosing = false
  while (p < src.length) {
    const ch = src[p]
    if (/\s/.test(ch)) {
      p++
      continue
    }
    if (ch === ">") {
      p++
      return { kind: isClose ? "close" : "open", name, attrs, selfClosing, jinjaOutsideValues, start: i, end: p }
    }
    if (ch === "/" && src[p + 1] === ">") {
      selfClosing = true
      p += 2
      return { kind: isClose ? "close" : "open", name, attrs, selfClosing, jinjaOutsideValues, start: i, end: p }
    }
    if (ch === "{" && (src[p + 1] === "{" || src[p + 1] === "%" || src[p + 1] === "#")) {
      jinjaOutsideValues = true
      p = skipJinjaInTag(src, p)
      continue
    }
    const an = /^[^\s"'>/=]+/.exec(src.slice(p, p + 256))
    if (!an) {
      p++
      continue
    }
    const attrName = an[0]
    p += attrName.length
    let q = p
    while (q < src.length && /\s/.test(src[q])) q++
    if (src[q] !== "=") {
      attrs.push({ name: attrName.toLowerCase(), value: null })
      continue
    }
    q++
    while (q < src.length && /\s/.test(src[q])) q++
    const quote = src[q]
    if (quote === '"' || quote === "'") {
      // Внутри значения могут быть кавычки Jinja-строк: {{ x|default("a") }}.
      let r = q + 1
      while (r < src.length && src[r] !== quote) {
        if (src[r] === "{" && (src[r + 1] === "{" || src[r + 1] === "%")) {
          r = skipJinjaInTag(src, r)
          continue
        }
        r++
      }
      attrs.push({ name: attrName.toLowerCase(), value: src.slice(q + 1, r) })
      p = r + 1
    } else {
      let r = q
      while (r < src.length && !/[\s>]/.test(src[r])) {
        if (src[r] === "{" && (src[r + 1] === "{" || src[r + 1] === "%")) {
          r = skipJinjaInTag(src, r)
          continue
        }
        r++
      }
      attrs.push({ name: attrName.toLowerCase(), value: src.slice(q, r) })
      p = r
    }
  }
  return null
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let textStart = 0
  const flushText = (until: number) => {
    if (until > textStart) tokens.push({ kind: "text", start: textStart, end: until })
  }
  while (i < src.length) {
    const ch = src[i]
    if (ch === "{" && (src[i + 1] === "{" || src[i + 1] === "%" || src[i + 1] === "#")) {
      const t = readJinja(src, i)
      if (t) {
        flushText(i)
        tokens.push(t)
        i = t.end
        textStart = i
        continue
      }
    }
    if (ch === "<") {
      if (src.startsWith("<!--", i)) {
        const end = src.indexOf("-->", i + 4)
        const stop = end < 0 ? src.length : end + 3
        flushText(i)
        tokens.push({ kind: "comment", start: i, end: stop })
        i = stop
        textStart = i
        continue
      }
      if (src[i + 1] === "!" || src[i + 1] === "?") {
        const end = src.indexOf(">", i)
        const stop = end < 0 ? src.length : end + 1
        flushText(i)
        tokens.push({ kind: "doctype", start: i, end: stop })
        i = stop
        textStart = i
        continue
      }
      if (/[A-Za-z/]/.test(src[i + 1] ?? "")) {
        const tag = readTag(src, i)
        if (tag) {
          flushText(i)
          tokens.push(tag)
          i = tag.end
          textStart = i
          if (tag.kind === "open" && !tag.selfClosing && RAW_TEXT_TAGS.has(tag.name)) {
            const closeRe = new RegExp(`</${tag.name}\\s*>`, "ig")
            closeRe.lastIndex = i
            const found = closeRe.exec(src)
            const contentEnd = found ? found.index : src.length
            if (contentEnd > i) tokens.push({ kind: "jrawblock", start: i, end: contentEnd })
            i = contentEnd
            textStart = i
          }
          continue
        }
      }
    }
    i++
  }
  flushText(src.length)
  return tokens
}

export function isWhitespaceText(src: string, t: Token): boolean {
  return t.kind === "text" && src.slice(t.start, t.end).trim() === ""
}
