import nunjucks from "nunjucks"
import { barcodeDataUri, normalizeBarcodeOptions } from "./barcode.ts"
import { formatDate, formatNumber } from "./format.ts"
import { tokenize, VOID_TAGS } from "./jinja/tokenize.ts"

/**
 * Серверный рендер шаблонов: синтаксис Jinja, движок Nunjucks.
 *
 * Nunjucks не песочница: выражение вида range.constructor("…")() исполнит код на сервере.
 * Поэтому шаблон до рендера проходит проверку AST — запрещены служебные свойства,
 * динамический доступ obj[expr], include/extends/import и любые функции вне белого списка.
 * В контекст попадают только данные документа (JSON), без моделей и объектов backend.
 */

type NjNode = { typename: string; fields: string[]; [key: string]: unknown }

const FORBIDDEN_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "call",
  "apply",
  "bind",
  "eval",
  "Function",
  "require",
  "process",
  "global",
  "globalThis",
  "module",
  "exports",
])

const ALLOWED_FILTERS = new Set([
  "abs",
  "batch",
  "capitalize",
  "center",
  "default",
  "d",
  "dictsort",
  "dump",
  "escape",
  "e",
  "first",
  "float",
  "groupby",
  "indent",
  "int",
  "join",
  "last",
  "length",
  "list",
  "lower",
  "nl2br",
  "replace",
  "reverse",
  "round",
  "safe",
  "selectattr",
  "rejectattr",
  "slice",
  "sort",
  "string",
  "striptags",
  "sum",
  "title",
  "trim",
  "truncate",
  "upper",
  "urlencode",
  "wordcount",
  // свои
  "date",
  "number",
  "money",
  "inn",
])

const ALLOWED_GLOBALS = new Set(["barcode", "range", "cycler", "joiner", "now", "caller"])

const ALLOWED_METHODS = new Set([
  "items",
  "keys",
  "values",
  "get",
  "upper",
  "lower",
  "strip",
  "lstrip",
  "rstrip",
  "startswith",
  "endswith",
  "split",
  "replace",
  "title",
  "capitalize",
  "isdigit",
  "count",
  "join",
  "cycle",
  "next",
  "reset",
])

export class TemplateError extends Error {
  line?: number
  constructor(message: string, line?: number) {
    super(message)
    this.name = "TemplateError"
    this.line = line
  }
}

function nodeLine(node: NjNode): number | undefined {
  const l = node.lineno as number | undefined
  return typeof l === "number" ? l + 1 : undefined
}

function fail(node: NjNode, message: string): never {
  const line = nodeLine(node)
  throw new TemplateError(line ? `Строка ${line}: ${message}` : message, line)
}

function checkName(node: NjNode, name: unknown) {
  if (typeof name !== "string") return
  if (FORBIDDEN_NAMES.has(name) || name.startsWith("__")) fail(node, `обращение к «${name}» запрещено`)
}

function children(node: NjNode): NjNode[] {
  const out: NjNode[] = []
  for (const f of node.fields ?? []) {
    const v = node[f]
    if (Array.isArray(v)) v.forEach((x) => x && typeof x === "object" && "typename" in x && out.push(x as NjNode))
    else if (v && typeof v === "object" && "typename" in (v as object)) out.push(v as NjNode)
  }
  return out
}

function collectMacros(node: NjNode, names: Set<string>) {
  if (node.typename === "Macro" || node.typename === "Caller") {
    const n = node.name as NjNode | undefined
    if (n && typeof n.value === "string") names.add(n.value)
  }
  if (node.typename === "Set") {
    for (const t of (node.targets as NjNode[]) ?? []) if (typeof t.value === "string") names.add(t.value)
  }
  if (node.typename === "For") {
    const n = node.name as NjNode | undefined
    if (n && typeof n.value === "string") names.add(n.value)
  }
  children(node).forEach((c) => collectMacros(c, names))
}

function validateNode(node: NjNode, callables: Set<string>) {
  switch (node.typename) {
    case "Extends":
    case "Include":
    case "Import":
    case "FromImport":
      fail(node, "include/extends/import в шаблонах документов не поддерживаются")
    // eslint-disable-next-line no-fallthrough
    case "CallExtension":
    case "CallExtensionAsync":
      fail(node, "расширения Nunjucks запрещены")
    // eslint-disable-next-line no-fallthrough
    case "Symbol":
      checkName(node, node.value)
      break
    case "LookupVal": {
      const val = node.val as NjNode
      if (val.typename === "Literal") {
        checkName(node, val.value)
      } else if (val.typename !== "Slice") {
        fail(node, "динамический доступ obj[выражение] запрещён — используйте obj.поле или obj[0]")
      }
      break
    }
    case "Filter": {
      const name = node.name as NjNode
      if (!ALLOWED_FILTERS.has(String(name.value))) fail(node, `фильтр «${String(name.value)}» не разрешён`)
      ;(node.args as NjNode) && validateNode(node.args as NjNode, callables)
      return
    }
    case "FunCall": {
      const name = node.name as NjNode
      if (name.typename === "Symbol") {
        const fn = String(name.value)
        if (!ALLOWED_GLOBALS.has(fn) && !callables.has(fn)) fail(node, `функция «${fn}» не разрешена`)
      } else if (name.typename === "LookupVal") {
        const method = (name.val as NjNode)?.value
        if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) fail(node, `вызов метода «${String(method)}» не разрешён`)
      } else {
        fail(node, "вызов выражения запрещён")
      }
      break
    }
  }
  for (const c of children(node)) validateNode(c, callables)
}

export function validateTemplate(source: string): void {
  let root: NjNode
  try {
    root = (nunjucks as unknown as { parser: { parse: (s: string) => NjNode } }).parser.parse(source) as NjNode
  } catch (e) {
    throw new TemplateError(`Ошибка синтаксиса шаблона: ${(e as Error).message}`)
  }
  const callables = new Set<string>()
  collectMacros(root, callables)
  validateNode(root, callables)
}

function cappedRange(start: number, stop?: number, step = 1): number[] {
  if (stop === undefined) {
    stop = start
    start = 0
  }
  const out: number[] = []
  if (!step) return out
  for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
    out.push(i)
    if (out.length >= 5000) break
  }
  return out
}

let compatInstalled = false

function createEnv(): nunjucks.Environment {
  if (!compatInstalled) {
    nunjucks.installJinjaCompat()
    // Совместимость с Jinja добавляет dict.items()/keys()/values(); но поле данных
    // с тем же именем (document.items) важнее метода — иначе цикл по позициям пуст.
    const runtime = nunjucks.runtime as unknown as { memberLookup: (...args: unknown[]) => unknown }
    const compatLookup = runtime.memberLookup
    runtime.memberLookup = function (this: unknown, ...args: unknown[]) {
      const [obj, key] = args
      if (args.length !== 4 && obj && typeof obj === "object" && typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = (obj as Record<string, unknown>)[key]
        if (typeof value !== "function") return value
      }
      return compatLookup.apply(this, args)
    }
    compatInstalled = true
  }
  const env = new nunjucks.Environment(null, { autoescape: true, throwOnUndefined: false })
  env.addFilter("date", (v: unknown, fmt?: string) => formatDate(v, fmt || "DD.MM.YYYY"))
  env.addFilter("number", (v: unknown, decimals?: number) => formatNumber(v, decimals))
  env.addFilter("money", (v: unknown) => formatNumber(v, 2))
  env.addFilter("inn", (v: unknown) => String(v ?? "").replace(/\D/g, ""))
  env.addGlobal("range", cappedRange)
  env.addGlobal("now", () => new Date().toISOString())
  env.addGlobal("barcode", (value: unknown, kind?: string, ecc?: string, humanReadable?: boolean, rotate?: number) =>
    barcodeDataUri(String(value ?? ""), normalizeBarcodeOptions({ kind, ecc, humanReadable, rotate }))
  )
  return env
}

let sharedEnv: nunjucks.Environment | null = null

/** В типах nunjucks нет runtime.markSafe, хотя функция есть. */
const markSafe = (s: string): unknown => (nunjucks.runtime as unknown as { markSafe: (v: string) => unknown }).markSafe(s)

export const PAGE_NUMBER_MARKUP = '<span class="doc-page-number"></span>'
export const PAGE_TOTAL_MARKUP = '<span class="doc-page-total"></span>'

/** Только JSON: функции, классы и прототипы backend в шаблон не попадают. */
function toPlainData(data: unknown): Record<string, unknown> {
  const plain = JSON.parse(JSON.stringify(data ?? {}))
  return plain && typeof plain === "object" && !Array.isArray(plain) ? plain : {}
}

export function renderTemplate(source: string, data: unknown, opts: { printUser?: string } = {}): string {
  validateTemplate(source)
  sharedEnv ??= createEnv()
  const ctx = toPlainData(data)
  const today = new Date().toISOString().slice(0, 10)
  const print = (ctx.print && typeof ctx.print === "object" ? ctx.print : {}) as Record<string, unknown>
  const context = {
    ...ctx,
    print: { date: today, user: opts.printUser ?? "", ...print },
    page: {
      number: markSafe(PAGE_NUMBER_MARKUP),
      total: markSafe(PAGE_TOTAL_MARKUP),
    },
  }
  try {
    return sharedEnv.renderString(source, context)
  } catch (e) {
    const msg = (e as Error).message.replace(/^\(unknown path\)\s*/, "")
    throw new TemplateError(`Ошибка рендера: ${msg}`)
  }
}

export type ExtractedRegion = { html: string; region: "header" | "footer" }

/** Вырезает элемент с атрибутом data-doc-region; возвращает его HTML и документ без него. */
function cutElement(html: string, match: (attrs: Map<string, string | null>) => boolean): { cut: string; rest: string } | null {
  const tokens = tokenize(html)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind !== "open") continue
    const attrs = new Map(t.attrs.map((a) => [a.name, a.value] as [string, string | null]))
    if (!match(attrs)) continue
    if (t.selfClosing || VOID_TAGS.has(t.name)) return { cut: html.slice(t.start, t.end), rest: html.slice(0, t.start) + html.slice(t.end) }
    let depth = 0
    for (let k = i; k < tokens.length; k++) {
      const x = tokens[k]
      if (x.kind === "open" && x.name === t.name && !x.selfClosing) depth++
      if (x.kind === "close" && x.name === t.name) {
        depth--
        if (depth === 0) return { cut: html.slice(t.start, x.end), rest: html.slice(0, t.start) + html.slice(x.end) }
      }
    }
    return null
  }
  return null
}

export type PreparedDocument = {
  html: string
  header: string | null
  footer: string | null
}

/**
 * Расставляет колонтитулы:
 *  - «только на первой» остаётся в начале документа;
 *  - «только на последней» переносится в конец документа;
 *  - «на каждой странице» для PDF уходит в header/footer-шаблон Chromium.
 */
export function placeRegions(rendered: string, mode: "html" | "pdf"): PreparedDocument {
  let html = rendered
  let header: string | null = null
  let footer: string | null = null
  for (let guard = 0; guard < 20; guard++) {
    const found = cutElement(html, (a) => a.has("data-doc-region"))
    if (!found) break
    const region = /data-doc-region="(header|footer)"/.exec(found.cut)?.[1] as "header" | "footer" | undefined
    const repeat = /data-doc-repeat="(all|first|last)"/.exec(found.cut)?.[1] ?? "all"
    const marked = found.cut.replace("data-doc-region=", "data-doc-placed=")
    html = found.rest
    if (mode === "pdf" && repeat === "all" && region) {
      if (region === "header") header = (header ?? "") + marked
      else footer = (footer ?? "") + marked
      continue
    }
    const body = /<body[^>]*>/i.exec(html)
    const bodyEnd = html.search(/<\/body>/i)
    const atStart = region === "header" && repeat !== "last"
    if (atStart && body) {
      const at = body.index + body[0].length
      html = html.slice(0, at) + marked + html.slice(at)
    } else if (bodyEnd >= 0) {
      html = html.slice(0, bodyEnd) + marked + html.slice(bodyEnd)
    } else {
      html = atStart ? marked + html : html + marked
    }
  }
  return { html, header, footer }
}

/**
 * HTML-предпросмотр: тот же документ, но на экране показан как лист на сером фоне.
 * Печатные правила (@page, разрывы) не меняются — Ctrl+P даёт тот же результат, что PDF.
 */
export function decoratePreviewHtml(rendered: string): string {
  const { html } = placeRegions(rendered, "html")
  const size = /@page\s*\{[^}]*size:\s*([\d.]+)mm\s+([\d.]+)mm/i.exec(html)
  const width = size ? size[1] : "210"
  const height = size ? size[2] : "297"
  const style = `<style data-doc-preview>
@media screen {
  html { background: #e5e7eb; }
  body { width: ${width}mm; min-height: ${height}mm; margin: 8mm auto !important; box-shadow: 0 1px 3px rgba(15,23,42,.18), 0 8px 24px rgba(15,23,42,.08); }
  .doc-page + .doc-page { margin-top: 0; border-top: 1px dashed #cbd5e1; }
}
.doc-page-number::before { content: "1"; }
.doc-page-total::before { content: "1"; }
@media print { .doc-page-number::before, .doc-page-total::before { content: ""; } }
</style>`
  return html.includes("</head>") ? html.replace("</head>", `${style}</head>`) : style + html
}
