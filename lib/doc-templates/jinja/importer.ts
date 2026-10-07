import {
  ATTR_BRANCH,
  ATTR_COND,
  ATTR_FOR,
  ATTR_IF,
  ATTR_PREFIX_ATTR,
  ATTR_RAW,
  ATTR_VAR,
  ATTR_WRAP,
  escapeAttr,
  hasJinja,
} from "./markers.ts"
import { cleanAttrs, cleanCss, sanitizeTemplateHtml, serializeAttrsRaw } from "./sanitize.ts"
import {
  VOID_TAGS,
  tokenize,
  type HtmlAttr,
  type JinjaExprToken,
  type JinjaStmtToken,
  type TagToken,
  type Token,
} from "./tokenize.ts"

/**
 * Jinja HTML → «дизайн-HTML» для редактора.
 *
 * Понятные конструкции становятся data-aware разметкой:
 *   {{ expr }}                         → <span data-jinja-var="expr">
 *   {% if c %}<p>…</p>{% endif %}      → <p data-jinja-if="c">
 *   {% for x in xs %}<tr>…{% endfor %} → <tr data-jinja-for="x in xs">
 *   прочие if/for                      → обёртка data-jinja-wrap
 * Всё, что нельзя разобрать без потерь, уходит в data-jinja-raw целиком.
 */

export type PageGuess = {
  format?: string
  orientation?: "portrait" | "landscape"
  widthMm?: number
  heightMm?: number
  margins?: { top: number; right: number; bottom: number; left: number }
}

export type ImportResult = {
  html: string
  css: string
  warnings: string[]
  rawBlocks: number
  page: PageGuess | null
}

const BLOCK_KEYWORDS = new Set(["if", "for", "macro", "call", "filter", "block", "with", "autoescape", "trans"])
const MIDDLE_KEYWORDS = new Set(["elif", "elseif", "else", "pluralize"])

const TABLE_STRUCT = new Set(["table", "thead", "tbody", "tfoot", "tr", "colgroup"])
const INLINE_PARENTS = new Set([
  "p",
  "span",
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "small",
  "sub",
  "sup",
  "label",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "caption",
  "font",
  "button",
  "dt",
])
const BLOCK_TAG_RE = /<(div|p|table|ul|ol|h[1-6]|section|article|header|footer|blockquote|pre|hr|tr|td|th|tbody|thead)\b/i

function isBlockStmt(t: JinjaStmtToken): boolean {
  if (BLOCK_KEYWORDS.has(t.keyword)) return true
  return t.keyword === "set" && !t.args.includes("=")
}

function isEndStmt(t: JinjaStmtToken): boolean {
  return t.keyword.startsWith("end")
}

type ElNode = {
  t: "el"
  idx: number
  tag: TagToken
  closed: boolean
  children: Node[]
  dirIf?: string
  dirFor?: string
}
type Branch = { keyword: string; args: string; children: Node[] }
type BlockNode = { t: "block"; idx: number; endIdx: number; kind: "if" | "for"; branches: Branch[] }
type Node =
  | ElNode
  | BlockNode
  | { t: "text"; idx: number; s: string }
  | { t: "var"; idx: number; tok: JinjaExprToken }
  | { t: "raw"; idx: number; endIdx: number }
  | { t: "verbatim"; idx: number; s: string }

class InterleaveError extends Error {
  startIdx: number
  endIdx: number
  constructor(startIdx: number, endIdx: number) {
    super("jinja/html interleave")
    this.startIdx = startIdx
    this.endIdx = endIdx
  }
}

type Pairs = {
  html: Map<number, number>
  jinja: Map<number, { start: number; end: number }>
}

function computePairs(tokens: Token[]): Pairs {
  const html = new Map<number, number>()
  const jinja = new Map<number, { start: number; end: number }>()
  const hstack: { idx: number; name: string }[] = []
  const jstack: { idx: number; keyword: string; middles: number[] }[] = []
  tokens.forEach((t, idx) => {
    if (t.kind === "open" && !t.selfClosing && !VOID_TAGS.has(t.name)) {
      hstack.push({ idx, name: t.name })
    } else if (t.kind === "close") {
      for (let k = hstack.length - 1; k >= 0; k--) {
        if (hstack[k].name === t.name) {
          html.set(hstack[k].idx, idx)
          html.set(idx, hstack[k].idx)
          hstack.length = k
          break
        }
      }
    } else if (t.kind === "jstmt") {
      if (isEndStmt(t)) {
        const want = t.keyword.slice(3)
        for (let k = jstack.length - 1; k >= 0; k--) {
          if (jstack[k].keyword === want) {
            const span = { start: jstack[k].idx, end: idx }
            jinja.set(jstack[k].idx, span)
            jinja.set(idx, span)
            for (const m of jstack[k].middles) jinja.set(m, span)
            jstack.length = k
            break
          }
        }
      } else if (MIDDLE_KEYWORDS.has(t.keyword)) {
        if (jstack.length) jstack[jstack.length - 1].middles.push(idx)
      } else if (isBlockStmt(t)) {
        jstack.push({ idx, keyword: t.keyword, middles: [] })
      }
    }
  })
  return { html, jinja }
}

function expandSlice(pairs: Pairs, s: number, e: number): [number, number] {
  let changed = true
  while (changed) {
    changed = false
    for (let k = s; k <= e; k++) {
      const hp = pairs.html.get(k)
      if (hp != null) {
        if (hp < s) {
          s = hp
          changed = true
        }
        if (hp > e) {
          e = hp
          changed = true
        }
      }
      const jp = pairs.jinja.get(k)
      if (jp) {
        if (jp.start < s) {
          s = jp.start
          changed = true
        }
        if (jp.end > e) {
          e = jp.end
          changed = true
        }
      }
    }
  }
  return [s, e]
}

class Parser {
  src: string
  tokens: Token[]
  pairs: Pairs
  warnings: string[] = []

  constructor(src: string) {
    this.src = src
    this.tokens = tokenize(src)
    this.pairs = computePairs(this.tokens)
  }

  sourceOf(startIdx: number, endIdx: number): string {
    return this.src.slice(this.tokens[startIdx].start, this.tokens[endIdx].end)
  }

  /** Разбирает узлы до stop-токена. levelStart — индекс открывающего токена уровня (-1 для корня). */
  parseLevel(i: number, levelStart: number, stopAt: (idx: number) => boolean): { nodes: Node[]; i: number } {
    const nodes: Node[] = []
    while (i < this.tokens.length) {
      if (stopAt(i)) return { nodes, i }
      try {
        i = this.parseOne(i, nodes)
      } catch (e) {
        if (!(e instanceof InterleaveError) || e.startIdx <= levelStart) throw e
        while (nodes.length && nodes[nodes.length - 1].idx >= e.startIdx) nodes.pop()
        nodes.push({ t: "raw", idx: e.startIdx, endIdx: e.endIdx })
        this.warnings.push(`Фрагмент сохранён как Advanced Jinja: ${this.preview(e.startIdx, e.endIdx)}`)
        i = e.endIdx + 1
      }
    }
    return { nodes, i }
  }

  preview(s: number, e: number): string {
    const text = this.sourceOf(s, e).replace(/\s+/g, " ").trim()
    return text.length > 80 ? `${text.slice(0, 77)}…` : text
  }

  interleave(s: number, e: number): never {
    const [a, b] = expandSlice(this.pairs, s, e)
    throw new InterleaveError(a, b)
  }

  parseOne(i: number, nodes: Node[]): number {
    const tok = this.tokens[i]
    switch (tok.kind) {
      case "text":
        nodes.push({ t: "text", idx: i, s: this.src.slice(tok.start, tok.end) })
        return i + 1
      case "comment":
        nodes.push({ t: "verbatim", idx: i, s: this.src.slice(tok.start, tok.end) })
        return i + 1
      case "doctype":
        return i + 1
      case "jcomment":
        nodes.push({ t: "raw", idx: i, endIdx: i })
        return i + 1
      case "jrawblock": {
        const prev = this.tokens[i - 1]
        if (prev && prev.kind === "open" && (prev.name === "textarea" || prev.name === "title")) {
          nodes.push({ t: "text", idx: i, s: this.src.slice(tok.start, tok.end) })
        } else {
          nodes.push({ t: "raw", idx: i, endIdx: i })
        }
        return i + 1
      }
      case "jexpr":
        if (tok.trimLeft || tok.trimRight || !tok.body) nodes.push({ t: "raw", idx: i, endIdx: i })
        else nodes.push({ t: "var", idx: i, tok })
        return i + 1
      case "jstmt":
        return this.parseStmt(i, tok, nodes)
      case "close": {
        const open = this.pairs.html.get(i)
        if (open == null) {
          nodes.push({ t: "raw", idx: i, endIdx: i })
          return i + 1
        }
        // Закрывающий тег элемента, открытого до текущего уровня Jinja.
        this.interleave(open, i)
      }
      // eslint-disable-next-line no-fallthrough
      case "open":
        return this.parseElement(i, tok, nodes)
    }
    return i + 1
  }

  parseElement(i: number, tok: TagToken, nodes: Node[]): number {
    const closeIdx = this.pairs.html.get(i)
    if (tok.jinjaOutsideValues) {
      const end = closeIdx ?? i
      nodes.push({ t: "raw", idx: i, endIdx: end })
      this.warnings.push(`Тег с Jinja между атрибутами сохранён как Advanced Jinja: ${this.preview(i, end)}`)
      return end + 1
    }
    if (tok.selfClosing || VOID_TAGS.has(tok.name) || closeIdx == null) {
      nodes.push({ t: "el", idx: i, tag: tok, closed: false, children: [] })
      return i + 1
    }
    const { nodes: children } = this.parseLevel(i + 1, i, (k) => k === closeIdx)
    nodes.push({ t: "el", idx: i, tag: tok, closed: true, children })
    return closeIdx + 1
  }

  parseStmt(i: number, tok: JinjaStmtToken, nodes: Node[]): number {
    const span = this.pairs.jinja.get(i)
    if (isEndStmt(tok) || MIDDLE_KEYWORDS.has(tok.keyword)) {
      if (!span) {
        nodes.push({ t: "raw", idx: i, endIdx: i })
        this.warnings.push(`Непарный тег Jinja: ${this.preview(i, i)}`)
        return i + 1
      }
      // Конец/ветка блока, начатого вне текущего HTML-элемента.
      this.interleave(span.start, span.end)
    }
    if (!isBlockStmt(tok)) {
      nodes.push({ t: "raw", idx: i, endIdx: i })
      return i + 1
    }
    if (!span) {
      nodes.push({ t: "raw", idx: i, endIdx: i })
      this.warnings.push(`Незакрытый блок Jinja: ${this.preview(i, i)}`)
      return i + 1
    }
    if ((tok.keyword !== "if" && tok.keyword !== "for") || tok.trimLeft || tok.trimRight) {
      const [s, e] = expandSlice(this.pairs, i, span.end)
      if (s < i) this.interleave(s, e)
      nodes.push({ t: "raw", idx: i, endIdx: e })
      return e + 1
    }
    const branches: Branch[] = []
    let keyword = tok.keyword
    let args = tok.args
    let k = i + 1
    for (;;) {
      const { nodes: children, i: next } = this.parseLevel(k, i, (idx) => {
        const t = this.tokens[idx]
        return t.kind === "jstmt" && this.pairs.jinja.get(idx)?.start === i && idx !== i
      })
      branches.push({ keyword, args, children })
      const stopTok = this.tokens[next] as JinjaStmtToken
      if (!stopTok || next === span.end) break
      if (stopTok.trimLeft || stopTok.trimRight) {
        const [s, e] = expandSlice(this.pairs, i, span.end)
        if (s < i) this.interleave(s, e)
        nodes.push({ t: "raw", idx: i, endIdx: e })
        return e + 1
      }
      keyword = stopTok.keyword === "elseif" ? "elif" : stopTok.keyword
      args = stopTok.args
      k = next + 1
    }
    const endTok = this.tokens[span.end] as JinjaStmtToken
    if (endTok.trimLeft || endTok.trimRight) {
      nodes.push({ t: "raw", idx: i, endIdx: span.end })
      return span.end + 1
    }
    nodes.push({ t: "block", idx: i, endIdx: span.end, kind: tok.keyword as "if" | "for", branches })
    return span.end + 1
  }
}

function significant(nodes: Node[]): Node[] {
  return nodes.filter((n) => !(n.t === "text" && n.s.trim() === "") && n.t !== "verbatim")
}

/** Снизу вверх: блок с единственным элементом превращается в директиву на этом элементе. */
function lower(nodes: Node[]): Node[] {
  return nodes.map((n) => {
    if (n.t === "el") {
      n.children = lower(n.children)
      return n
    }
    if (n.t !== "block") return n
    n.branches.forEach((b) => (b.children = lower(b.children)))
    if (n.branches.length !== 1) return n
    const sig = significant(n.branches[0].children)
    if (sig.length !== 1 || sig[0].t !== "el") return n
    const el = sig[0]
    if (n.kind === "if" && !el.dirIf && !el.dirFor) {
      el.dirIf = n.branches[0].args
      return el
    }
    if (n.kind === "for" && !el.dirFor) {
      el.dirFor = n.branches[0].args
      return el
    }
    return n
  })
}

type Ctx = { parent: string | null }

class Emitter {
  p: Parser
  rawBlocks = 0
  constructor(p: Parser) {
    this.p = p
  }

  holderTag(ctx: Ctx, source: string): string {
    switch (ctx.parent) {
      case "table":
        return "tbody"
      case "thead":
      case "tbody":
      case "tfoot":
        return "tr"
      case "tr":
        return "td"
      case "colgroup":
        return "col"
    }
    if (ctx.parent && INLINE_PARENTS.has(ctx.parent)) return "span"
    return BLOCK_TAG_RE.test(source) ? "div" : "span"
  }

  raw(source: string, ctx: Ctx): string {
    this.rawBlocks++
    const tag = this.holderTag(ctx, source)
    return tag === "col"
      ? `<col ${ATTR_RAW}="${escapeAttr(source)}">`
      : `<${tag} ${ATTR_RAW}="${escapeAttr(source)}"></${tag}>`
  }

  isTableCtx(ctx: Ctx): boolean {
    return !!ctx.parent && TABLE_STRUCT.has(ctx.parent)
  }

  emitAll(nodes: Node[], ctx: Ctx): string {
    return nodes.map((n) => this.emit(n, ctx)).join("")
  }

  emit(n: Node, ctx: Ctx): string {
    switch (n.t) {
      case "text":
        if (this.isTableCtx(ctx) && n.s.trim() !== "") return this.raw(n.s, ctx)
        return n.s
      case "verbatim":
        return n.s
      case "raw":
        return this.raw(this.p.sourceOf(n.idx, n.endIdx), ctx)
      case "var":
        if (this.isTableCtx(ctx)) return this.raw(this.p.sourceOf(n.idx, n.idx), ctx)
        return `<span ${ATTR_VAR}="${escapeAttr(n.tok.body)}"></span>`
      case "el":
        return this.emitElement(n)
      case "block":
        return this.emitBlock(n, ctx)
    }
  }

  emitElement(n: ElNode): string {
    const { attrs } = cleanAttrs(n.tag.attrs)
    const out: HtmlAttr[] = []
    for (const a of attrs) {
      if (hasJinja(a.value)) out.push({ name: `${ATTR_PREFIX_ATTR}${a.name}`, value: a.value })
      else out.push(a)
    }
    if (n.dirFor != null) out.push({ name: ATTR_FOR, value: escapeAttr(n.dirFor) })
    if (n.dirIf != null) out.push({ name: ATTR_IF, value: escapeAttr(n.dirIf) })
    const open = `<${n.tag.name}${serializeAttrsRaw(out)}>`
    if (!n.closed) return VOID_TAGS.has(n.tag.name) ? open : `${open}${this.emitAll(n.children, { parent: n.tag.name })}`
    return `${open}${this.emitAll(n.children, { parent: n.tag.name })}</${n.tag.name}>`
  }

  emitBlock(n: BlockNode, ctx: Ctx): string {
    const source = this.p.sourceOf(n.idx, n.endIdx)
    if (this.isTableCtx(ctx)) return this.raw(source, ctx)
    const inline = (ctx.parent && INLINE_PARENTS.has(ctx.parent)) || !BLOCK_TAG_RE.test(source)
    const tag = inline ? "span" : "div"
    const inner = (b: Branch) => this.emitAll(b.children, { parent: tag })
    if (n.kind === "if") {
      if (n.branches.length === 1) {
        return `<${tag} ${ATTR_WRAP}="if" ${ATTR_IF}="${escapeAttr(n.branches[0].args)}">${inner(n.branches[0])}</${tag}>`
      }
      const parts = n.branches.map((b) => {
        const cond = b.keyword === "else" ? "" : ` ${ATTR_COND}="${escapeAttr(b.args)}"`
        return `<${tag} ${ATTR_BRANCH}="${b.keyword}"${cond}>${inner(b)}</${tag}>`
      })
      return `<${tag} ${ATTR_WRAP}="if">${parts.join("")}</${tag}>`
    }
    const head = escapeAttr(n.branches[0].args)
    if (n.branches.length === 1) {
      return `<${tag} ${ATTR_WRAP}="for" ${ATTR_FOR}="${head}">${inner(n.branches[0])}</${tag}>`
    }
    const parts = n.branches.map((b, idx) => `<${tag} ${ATTR_BRANCH}="${idx === 0 ? "body" : "else"}">${inner(b)}</${tag}>`)
    return `<${tag} ${ATTR_WRAP}="for" ${ATTR_FOR}="${head}">${parts.join("")}</${tag}>`
  }
}

const PAGE_FORMATS: Record<string, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  LETTER: [215.9, 279.4],
  LEGAL: [215.9, 355.6],
}

function toMm(value: string): number | null {
  const m = /^(-?[\d.]+)\s*(mm|cm|in|pt|px)?$/i.exec(value.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  switch ((m[2] || "px").toLowerCase()) {
    case "mm":
      return n
    case "cm":
      return n * 10
    case "in":
      return n * 25.4
    case "pt":
      return (n * 25.4) / 72
    default:
      return (n * 25.4) / 96
  }
}

function parsePageRule(body: string): PageGuess {
  const guess: PageGuess = {}
  const size = /(?:^|;)\s*size\s*:\s*([^;]+)/i.exec(body)?.[1]?.trim()
  if (size) {
    const parts = size.split(/\s+/)
    const fmt = parts.find((p) => PAGE_FORMATS[p.toUpperCase()])
    if (fmt) {
      guess.format = fmt.toUpperCase() === "LETTER" ? "Letter" : fmt.toUpperCase()
      const [w, h] = PAGE_FORMATS[fmt.toUpperCase()]
      guess.widthMm = w
      guess.heightMm = h
    } else {
      const dims = parts.map(toMm).filter((v): v is number => v != null)
      if (dims.length === 2) {
        guess.format = "Custom"
        guess.widthMm = dims[0]
        guess.heightMm = dims[1]
      }
    }
    if (parts.includes("landscape")) guess.orientation = "landscape"
    else if (guess.widthMm && guess.heightMm) guess.orientation = guess.widthMm > guess.heightMm ? "landscape" : "portrait"
  }
  const margin = /(?:^|;)\s*margin\s*:\s*([^;]+)/i.exec(body)?.[1]?.trim()
  if (margin) {
    const v = margin.split(/\s+/).map(toMm)
    if (v.every((x) => x != null)) {
      const [t, r = t, b = t, l = r] = v as number[]
      guess.margins = { top: t, right: r, bottom: b, left: l }
    }
  }
  return guess
}

/** Отделяет <style> и @page от тела документа. */
function splitDocument(src: string): { body: string; css: string; page: PageGuess | null } {
  const tokens = tokenize(src)
  const cssParts: string[] = []
  let basePage: string | null = null
  const bodyParts: string[] = []
  let inBody = !tokens.some((t) => t.kind === "open" && t.name === "body")
  let inHead = false
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.kind === "open" && t.name === "style") {
      const content = tokens[k + 1]
      const generated = t.attrs.some((a) => a.name === "data-doc-base")
      if (content && content.kind === "jrawblock") {
        // Базовый CSS листа генерируется из настроек страницы — не дублируем его.
        const chunk = src.slice(content.start, content.end)
        if (generated) basePage = /@page\s*\{([^}]*)\}/i.exec(chunk)?.[1] ?? basePage
        else cssParts.push(chunk)
        k++
      }
      if (tokens[k + 1]?.kind === "close") k++
      continue
    }
    if (t.kind === "open" && t.name === "body") {
      inBody = true
      continue
    }
    if (t.kind === "close" && t.name === "body") {
      inBody = false
      continue
    }
    if (t.kind === "open" && t.name === "head") {
      inHead = true
      continue
    }
    if (t.kind === "close" && t.name === "head") {
      inHead = false
      continue
    }
    if ((t.kind === "open" || t.kind === "close") && t.name === "html") continue
    if (t.kind === "doctype") continue
    if (inHead) continue
    if (!inBody) {
      // Jinja до <body>/после </body> (extends, set, import) не теряем.
      if (t.kind === "jstmt" || t.kind === "jcomment" || t.kind === "jexpr") bodyParts.push(src.slice(t.start, t.end))
      continue
    }
    bodyParts.push(src.slice(t.start, t.end))
  }
  let css = cssParts.join("\n")
  let page: PageGuess | null = basePage ? parsePageRule(basePage) : null
  css = css.replace(/@page\s*(?::first|:left|:right)?\s*\{([^}]*)\}/gi, (whole, body: string) => {
    if (!/^@page\s*\{/i.test(whole)) return whole
    page = { ...(page ?? {}), ...parsePageRule(body) }
    return ""
  })
  return { body: bodyParts.join("").trim(), css: cleanCss(css).trim(), page }
}

export function importJinjaTemplate(source: string): ImportResult {
  const { html: sanitized, removed } = sanitizeTemplateHtml(source)
  const { body, css, page } = splitDocument(sanitized)
  const parser = new Parser(body)
  const { nodes } = parser.parseLevel(0, -1, () => false)
  const emitter = new Emitter(parser)
  const html = emitter.emitAll(lower(nodes), { parent: null })
  const warnings = [...removed.map((r) => `Удалено небезопасное: ${r}`), ...parser.warnings]
  return { html, css, warnings, rawBlocks: emitter.rawBlocks, page }
}
