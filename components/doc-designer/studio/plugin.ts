import type { Component, Editor } from "grapesjs"
import { barcodeDesignHtml, barcodeSvg, normalizeBarcodeBlock, barcodeSizeStyle, isLinearBarcode, type BarcodeBlockConfig } from "@/lib/doc-templates/barcode"
import { DOC_COMPONENTS_CSS } from "@/lib/doc-templates/components-css"
import { dataTableDesignHtml, dataTablePreviewHtml, normalizeDataTable, type DataTableConfig } from "@/lib/doc-templates/data-table"
import { evaluateCondition, parseLoopHeader } from "@/lib/doc-templates/jinja/expressions"
import { ATTR_BRANCH, ATTR_COND, ATTR_FOR, ATTR_IF, ATTR_RAW, ATTR_VAR, ATTR_WRAP, escapeAttr, escapeText } from "@/lib/doc-templates/jinja/markers"
import { evaluatePreview, loopScope, type PreviewScope } from "@/lib/doc-templates/preview-eval"
import { mmToPx, pageSizeMm } from "@/lib/doc-templates/page"
import type { DesignerStore } from "../state"
import { labelForExpr, shortLabel, type LoopContext } from "./labels"
import { BLOCK_ICONS, CMP_ICONS } from "./icons"

/**
 * Документные компоненты поверх GrapesJS (через Studio SDK).
 * Jinja живёт в атрибутах data-jinja-*; на холсте — читаемые чипы и рамки,
 * в режиме DATA PREVIEW — значения из тестовых данных. Шаблон при этом не меняется.
 */

export const DOC_TYPES = {
  variable: "doc-var",
  table: "doc-data-table",
  barcode: "doc-barcode",
  raw: "doc-raw",
  region: "doc-region",
  pageBreak: "doc-page-break",
} as const

const TEXT_STYLE_PROPS = ["font-family", "font-size", "font-weight", "font-style", "color", "background-color", "text-decoration", "letter-spacing"]

function attrString(attrs: Record<string, unknown>): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true || v === "" ? ` ${k}` : ` ${k}="${escapeAttr(String(v))}"`))
    .join("")
}

/** Контекст циклов и данные предпросмотра для компонента (по директивам предков). */
export function contextFor(cmp: Component | undefined, store: DesignerStore): { loops: LoopContext; scope: PreviewScope; counts: number[] } {
  const chain: Component[] = []
  let cur: Component | undefined = cmp
  while (cur) {
    chain.unshift(cur)
    cur = cur.parent()
  }
  const loops: LoopContext = {}
  // Нумерация страниц известна только при печати PDF; на холсте — «1 из 1».
  let scope: PreviewScope = { page: { number: 1, total: 1 }, ...store.get().sampleData }
  const counts: number[] = []
  for (const c of chain) {
    const header = c.getAttributes()[ATTR_FOR]
    if (typeof header !== "string") continue
    const loop = parseLoopHeader(header)
    if (!loop) continue
    loops[loop.itemVar] = loops[loop.source.split(".")[0]] ? `${loops[loop.source.split(".")[0]]}.${loop.source.split(".").slice(1).join(".")}` : loop.source
    const next = loopScope(scope, loop.itemVar, loop.source, 0)
    scope = next.scope
    counts.push(next.count)
  }
  return { loops, scope, counts }
}

function renderVar(el: HTMLElement, cmp: Component, store: DesignerStore) {
  const expr = String(cmp.getAttributes()[ATTR_VAR] ?? "")
  const { schema, mode } = store.get()
  const { loops, scope } = contextFor(cmp, store)
  el.setAttribute("contenteditable", "false")
  if (mode === "data") {
    const v = evaluatePreview(expr, scope)
    el.removeAttribute("data-doc-missing")
    if (!v.ok) {
      el.textContent = `{{ ${expr} }}`
      el.setAttribute("data-doc-missing", "")
    } else if (v.text === "") {
      el.textContent = ""
      el.setAttribute("data-doc-empty", "")
    } else {
      el.removeAttribute("data-doc-empty")
      el.textContent = v.text
    }
    el.title = expr
    return
  }
  el.removeAttribute("data-doc-empty")
  const l = labelForExpr(schema, expr, loops)
  el.toggleAttribute("data-doc-missing", !l.known && !l.advanced)
  el.title = `{{ ${expr} }}`
  el.innerHTML = `<span class="doc-chip-ico">◇</span>${l.group ? `<span class="doc-chip-g">${escapeText(l.group)}</span>` : ""}<span class="doc-chip-l">${escapeText(l.label)}</span>${l.format ? `<span class="doc-chip-f">${escapeText(l.format)}</span>` : ""}`
}

export function readTableConfigPublic(cmp: Component): DataTableConfig {
  return readTableConfig(cmp)
}

function readTableConfig(cmp: Component): DataTableConfig {
  const raw = cmp.getAttributes()["data-doc-table"]
  try {
    return normalizeDataTable(typeof raw === "string" ? JSON.parse(raw) : raw)
  } catch {
    return normalizeDataTable({})
  }
}

export function writeTableConfig(cmp: Component, cfg: DataTableConfig) {
  cmp.addAttributes({ "data-doc-table": JSON.stringify(cfg) })
}

export function readBarcodeConfig(cmp: Component): BarcodeBlockConfig {
  const raw = cmp.getAttributes()["data-doc-barcode"]
  try {
    return normalizeBarcodeBlock(typeof raw === "string" ? JSON.parse(raw) : raw)
  } catch {
    return normalizeBarcodeBlock({})
  }
}

export function writeBarcodeConfig(cmp: Component, cfg: BarcodeBlockConfig) {
  cmp.addAttributes({ "data-doc-barcode": JSON.stringify(cfg) })
}

function stripTable(html: string): string {
  return html.replace(/^<table[^>]*>/, "").replace(/<\/table>$/, "")
}

function renderTable(el: HTMLElement, cmp: Component, store: DesignerStore) {
  const cfg = readTableConfig(cmp)
  const { schema, mode } = store.get()
  const { loops, scope } = contextFor(cmp, store)
  const tableLoops = { ...loops, [cfg.itemVar]: loops[cfg.source.split(".")[0]] ?? cfg.source }
  const html = dataTablePreviewHtml(cfg, {
    mode,
    scope,
    labelFor: (expr) => (expr === cfg.source ? shortLabel(schema, expr, loops) : labelForExpr(schema, expr, tableLoops).label),
  })
  el.innerHTML = stripTable(html)
  const style = /^<table[^>]*style="([^"]*)"/.exec(html)?.[1] ?? ""
  el.setAttribute("style", style)
}

function renderBarcode(el: HTMLElement, cmp: Component, store: DesignerStore) {
  const cfg = readBarcodeConfig(cmp)
  const { scope } = contextFor(cmp, store)
  const v = evaluatePreview(cfg.expr, scope)
  const value = v.ok && v.text ? v.text : cfg.kind === "ean13" ? "4600000000003" : cfg.expr || "0000"
  const svg = barcodeSvg(value, cfg)
  ;(el as HTMLImageElement).src = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : ""
  el.setAttribute("style", `${barcodeSizeStyle(cfg)};object-fit:contain`)
  el.title = svg ? `${cfg.kind}: ${value}` : `Данные «${value}» не подходят для ${cfg.kind}`
  el.toggleAttribute("data-doc-missing", !svg)
}

function renderRaw(el: HTMLElement, cmp: Component) {
  const src = String(cmp.getAttributes()[ATTR_RAW] ?? "")
  const preview = src.length > 400 ? `${src.slice(0, 400)}…` : src
  const tag = el.tagName.toLowerCase()
  const body = `<span class="doc-raw-badge">Advanced Jinja</span><code>${escapeText(preview)}</code>`
  if (tag === "tr") el.innerHTML = `<td colspan="99">${body}</td>`
  else if (tag === "tbody") el.innerHTML = `<tr><td colspan="99">${body}</td></tr>`
  else el.innerHTML = body
  el.setAttribute("contenteditable", "false")
}

/** Подписи-бейджи для директив и регионов; DOM-атрибуты, в модель не попадают. */
function decorate(cmp: Component, store: DesignerStore) {
  const el = cmp.getEl()
  if (!el || el.nodeType !== 1) return
  const attrs = cmp.getAttributes()
  const { schema, mode } = store.get()
  const parts: string[] = []
  const loops = contextFor(cmp.parent(), store).loops
  if (typeof attrs[ATTR_FOR] === "string") {
    const loop = parseLoopHeader(attrs[ATTR_FOR])
    parts.push(loop ? `↻ Повтор: ${shortLabel(schema, loop.source, loops)}` : `↻ for ${attrs[ATTR_FOR]}`)
  }
  if (typeof attrs[ATTR_IF] === "string") parts.push(`⎇ Если: ${conditionLabel(String(attrs[ATTR_IF]), store, loops)}`)
  if (attrs[ATTR_BRANCH]) {
    const b = String(attrs[ATTR_BRANCH])
    parts.push(b === "else" ? "Иначе" : b === "body" ? "Повтор" : `${b === "elif" ? "Иначе если" : "Если"}: ${conditionLabel(String(attrs[ATTR_COND] ?? ""), store, loops)}`)
  }
  if (attrs[ATTR_WRAP] === "if" && !attrs[ATTR_IF]) parts.push("⎇ Условие с вариантами")
  if (attrs["data-doc-region"]) {
    const repeat = { all: "на каждой странице", first: "только на первой", last: "только на последней" }[String(attrs["data-doc-repeat"] ?? "all")] ?? ""
    parts.push(`${attrs["data-doc-region"] === "header" ? "Верхний колонтитул" : "Нижний колонтитул"} · ${repeat}`)
  }
  if (parts.length) el.setAttribute("data-doc-badge", parts.join("  ·  "))
  else el.removeAttribute("data-doc-badge")

  let hidden = false
  let loopCount: number | null = null
  if (mode === "data") {
    const { scope, counts } = contextFor(cmp, store)
    if (typeof attrs[ATTR_IF] === "string") {
      const parentScope = contextFor(cmp.parent(), store).scope
      const r = evaluateCondition(String(attrs[ATTR_IF]), typeof attrs[ATTR_FOR] === "string" ? scope : parentScope)
      hidden = r === false
    }
    if (attrs[ATTR_BRANCH] === "if" || attrs[ATTR_BRANCH] === "elif") {
      hidden = evaluateCondition(String(attrs[ATTR_COND] ?? ""), scope) === false
    }
    if (typeof attrs[ATTR_FOR] === "string") loopCount = counts[counts.length - 1] ?? 0
  }
  el.toggleAttribute("data-doc-hidden", hidden)
  if (el.tagName === "IMG" && cmp.get("type") !== DOC_TYPES.barcode && typeof attrs["data-jinja-attr-src"] === "string") renderBoundImage(el as HTMLImageElement, String(attrs["data-jinja-attr-src"]), cmp, store)
  if (loopCount != null) el.setAttribute("data-doc-count", `×${loopCount}`)
  else el.removeAttribute("data-doc-count")
}

const EMPTY_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

/** Изображение из данных: в превью — значение из тестовых данных, иначе аккуратная заглушка. */
function renderBoundImage(el: HTMLImageElement, template: string, cmp: Component, store: DesignerStore) {
  const expr = /^\s*\{\{\s*([\s\S]*?)\s*\}\}\s*$/.exec(template)?.[1]
  const { scope } = contextFor(cmp, store)
  const v = expr ? evaluatePreview(expr, scope) : null
  const src = v && v.ok && /^(data:image\/|https?:\/\/|\/)/.test(v.text) ? v.text : ""
  el.src = src || EMPTY_PIXEL
  el.toggleAttribute("data-doc-bound-empty", !src)
  el.title = expr ? `Изображение из данных: ${expr}` : ""
}

function conditionLabel(cond: string, store: DesignerStore, loops: LoopContext): string {
  const { schema } = store.get()
  return cond.replace(/[A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)+|[A-Za-z_]\w*(?=\s*(?:==|!=|>|<|$))/g, (m) => {
    const l = labelForExpr(schema, m, loops)
    return l.known ? `«${l.label}»` : m
  })
    .replace(/==/g, "=")
    .replace(/\bnot\b/g, "не")
    .replace(/\band\b/g, "и")
    .replace(/\bor\b/g, "или")
}

export const CANVAS_CSS = `
[contenteditable] { outline: 0 solid transparent; }
${DOC_COMPONENTS_CSS}
html { background: transparent; }
[data-jinja-var] { border-radius: 3px; }
html[data-doc-mode="design"] [data-jinja-var] { display: inline; padding: 0 3px; background: #eef4ff; border: 1px solid #c7d7fe; color: #1e3a8a; font-size: 0.92em; line-height: 1.5; white-space: normal; overflow-wrap: anywhere; -webkit-box-decoration-break: clone; box-decoration-break: clone; cursor: pointer; }
html[data-doc-mode="design"] [data-jinja-var] > span + span { margin-left: 3px; }
html[data-doc-mode="design"] [data-jinja-var] .doc-chip-ico { color: #6366f1; font-size: .85em; }
html[data-doc-mode="design"] [data-jinja-var] .doc-chip-g { color: #64748b; font-size: .85em; }
html[data-doc-mode="design"] [data-jinja-var] .doc-chip-g::after { content: " ·"; }
html[data-doc-mode="design"] [data-jinja-var] .doc-chip-f { color: #7c3aed; font-size: .8em; border-left: 1px solid #c7d7fe; padding-left: 3px; }
html[data-doc-mode="design"] [data-jinja-var][data-doc-missing] { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
html[data-doc-mode="data"] [data-jinja-var] { background: rgba(250, 204, 21, .16); box-shadow: inset 0 -1px 0 rgba(202, 138, 4, .35); }
html[data-doc-mode="data"] [data-jinja-var][data-doc-missing] { background: #fef2f2; color: #991b1b; font-family: monospace; font-size: .85em; }
html[data-doc-mode="data"] [data-jinja-var][data-doc-empty]::before { content: "∅"; color: #cbd5e1; }
.doc-chip { display: inline; padding: 0 3px; background: #eef4ff; border: 1px solid #c7d7fe; border-radius: 3px; color: #1e3a8a; font-size: .9em; white-space: normal; overflow-wrap: anywhere; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.doc-table-loop-hint td { font-size: 8pt; color: #0369a1; background: #f0f9ff; border: 1px dashed #7dd3fc !important; text-align: left !important; }
[data-doc-badge] { position: relative; }
[data-jinja-if], [data-jinja-wrap], [data-jinja-branch] { outline: 1px dashed #f59e0b; outline-offset: 1px; }
[data-jinja-for] { outline: 1px dashed #0ea5e9; outline-offset: 1px; }
[data-doc-region] { outline: 1px dashed #94a3b8; outline-offset: 1px; min-height: 6mm; }
[data-jinja-wrap], [data-jinja-branch], [data-doc-region] { padding-top: 3.2mm; }
div[data-jinja-if]:not([data-jinja-wrap]), div[data-jinja-for]:not([data-jinja-wrap]) { padding-top: 3.2mm; }
[data-doc-badge]::before { content: attr(data-doc-badge); position: absolute; top: 0; left: 0; transform: translateY(-1px); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 7.5pt/1.5 Arial, sans-serif; letter-spacing: .01em; padding: 0 5px; border-radius: 0 0 4px 0; background: #fff7ed; color: #9a3412; z-index: 3; pointer-events: none; }
[data-jinja-for][data-doc-badge]::before { background: #f0f9ff; color: #075985; }
[data-doc-region][data-doc-badge]::before { background: #f1f5f9; color: #475569; }
tr[data-doc-badge]::before, td[data-doc-badge]::before { position: absolute; }
[data-doc-count]::after { content: attr(data-doc-count); position: absolute; top: 0; right: 0; font: 600 7.5pt/1.5 Arial, sans-serif; padding: 0 5px; background: #0ea5e9; color: #fff; border-radius: 0 0 0 4px; z-index: 3; pointer-events: none; }
[data-doc-hidden] { opacity: .32; }
[data-doc-hidden]::after { content: "скрыто условием"; position: absolute; top: 0; right: 0; font: 600 7.5pt/1.5 Arial, sans-serif; padding: 0 5px; background: #f59e0b; color: #fff; z-index: 3; }
[data-jinja-raw] { background: #f8fafc; border: 1px solid #cbd5e1; border-left: 3px solid #64748b; border-radius: 3px; color: #334155; font: 9pt/1.4 "SFMono-Regular", Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
div[data-jinja-raw] { display: block; padding: 4px 6px; margin: 1mm 0; }
span[data-jinja-raw] { display: inline-block; padding: 0 4px; max-width: 100%; vertical-align: middle; }
[data-jinja-raw] .doc-raw-badge { display: inline-block; margin-right: 6px; font: 600 7pt/1.6 Arial, sans-serif; color: #fff; background: #64748b; padding: 0 4px; border-radius: 2px; vertical-align: top; }
.doc-page-break { border-top: 1px dashed #64748b !important; height: 4mm !important; position: relative; break-after: auto; }
.doc-page-break::after { content: "Разрыв страницы"; position: absolute; top: -1px; left: 50%; transform: translate(-50%, -50%); font: 600 7.5pt/1.6 Arial, sans-serif; color: #475569; background: #fff; padding: 0 6px; }
img[data-doc-barcode][data-doc-missing] { outline: 1px dashed #ef4444; }
img[data-jinja-attr-src].gjs-plh-image { width: auto; height: auto; outline: none; background: none; display: inline-block; }
img[data-jinja-attr-src][data-doc-bound-empty] { outline: 1px dashed #a5b4fc; background: repeating-linear-gradient(45deg, #f5f7ff, #f5f7ff 4px, #eef2ff 4px, #eef2ff 8px); min-width: 12mm; min-height: 8mm; }
.doc-stamp:empty::before { content: "М.П."; }
html[data-doc-clean] [data-doc-badge]::before, html[data-doc-clean] [data-doc-count]::after, html[data-doc-clean] [data-doc-hidden]::after { display: none !important; }
html[data-doc-clean] [data-jinja-if], html[data-doc-clean] [data-jinja-for], html[data-doc-clean] [data-jinja-wrap], html[data-doc-clean] [data-jinja-branch], html[data-doc-clean] [data-doc-region] { outline: none !important; padding-top: 0 !important; }
html[data-doc-clean] body { background-image: none !important; }
html[data-doc-clean] [data-jinja-var] { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }
`

/** Мягкие направляющие листа: поля страницы и границы печатных листов на холсте. */
function sheetGuidesCss(store: DesignerStore): string {
  const { page } = store.get()
  const { height } = pageSizeMm(page)
  const m = page.margins
  return `body { min-height: ${height}mm; background-color: ${page.background};
  background-image:
    linear-gradient(to right, transparent calc(${m.left}mm - 1px), rgba(99,102,241,.18) calc(${m.left}mm - 1px), rgba(99,102,241,.18) ${m.left}mm, transparent ${m.left}mm, transparent calc(100% - ${m.right}mm), rgba(99,102,241,.18) calc(100% - ${m.right}mm), rgba(99,102,241,.18) calc(100% - ${m.right}mm + 1px), transparent calc(100% - ${m.right}mm + 1px)),
    repeating-linear-gradient(to bottom, transparent 0, transparent calc(${height}mm - 2px), rgba(100,116,139,.55) calc(${height}mm - 2px), rgba(100,116,139,.55) ${height}mm);
  background-repeat: no-repeat, repeat-y; }`
}

export type DocPluginOptions = { store: DesignerStore }

export function docDesignerPlugin(opts: DocPluginOptions) {
  return (editor: Editor) => {
    const { store } = opts
    const { Components } = editor

    Components.addType(DOC_TYPES.variable, {
      isComponent: (el: HTMLElement) =>
        el?.nodeType === 1 && el.hasAttribute?.(ATTR_VAR) ? { type: DOC_TYPES.variable, components: [] } : undefined,
      model: {
        defaults: {
          tagName: "span",
          name: "Переменная",
          icon: CMP_ICONS.variable,
          droppable: false,
          editable: false,
          textable: true,
          stylable: TEXT_STYLE_PROPS,
          components: [],
        },
        toHTML(this: Component, o?: Record<string, unknown>) {
          return `<span${attrString(this.getAttrToHTML(o as never))}></span>`
        },
      },
      view: {
        init(this: { listenTo: (...a: unknown[]) => void; model: Component; render: () => void }) {
          this.listenTo(this.model, "change:attributes doc:refresh", this.render)
        },
        onRender(this: unknown, { el, model }: { el: HTMLElement; model: Component }) {
          renderVar(el, model, store)
        },
      },
    })

    Components.addType(DOC_TYPES.table, {
      isComponent: (el: HTMLElement) =>
        el?.tagName === "TABLE" && el.hasAttribute("data-doc-table") ? { type: DOC_TYPES.table, components: [] } : undefined,
      model: {
        defaults: {
          tagName: "table",
          name: "Таблица данных",
          icon: CMP_ICONS.dataTable,
          droppable: false,
          editable: false,
          components: [],
          stylable: ["margin", "margin-top", "margin-bottom", "font-family", "font-size", "color"],
          attributes: { "data-doc-table": JSON.stringify(normalizeDataTable({})) },
        },
        toHTML(this: Component, o?: Record<string, unknown>) {
          const cfg = readTableConfig(this)
          const attrs = { ...this.getAttrToHTML(o as never) } as Record<string, unknown>
          delete attrs["data-doc-table"]
          const cls = attrs.class
          delete attrs.class
          delete attrs.style
          let html = dataTableDesignHtml(cfg, attrString(attrs))
          const own = String(cls ?? "")
            .split(/\s+/)
            .filter((c) => c && !["doc-table", "doc-rows-nobreak", "doc-no-repeat-head"].includes(c))
            .join(" ")
          if (own) html = html.replace('class="doc-table', `class="${escapeAttr(own)} doc-table`)
          return html
        },
      },
      view: {
        init(this: { listenTo: (...a: unknown[]) => void; model: Component; render: () => void }) {
          this.listenTo(this.model, "change:attributes doc:refresh", this.render)
        },
        onRender(this: unknown, { el, model }: { el: HTMLElement; model: Component }) {
          renderTable(el, model, store)
        },
      },
    })

    Components.addType(DOC_TYPES.barcode, {
      isComponent: (el: HTMLElement) => (el?.tagName === "IMG" && el.hasAttribute("data-doc-barcode") ? { type: DOC_TYPES.barcode } : undefined),
      model: {
        defaults: {
          tagName: "img",
          name: "Штрихкод",
          icon: CMP_ICONS.barcode,
          void: true,
          droppable: false,
          editable: false,
          resizable: false,
          stylable: ["margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "display", "vertical-align"],
          attributes: { "data-doc-barcode": JSON.stringify(normalizeBarcodeBlock({})) },
        },
        toHTML(this: Component, o?: Record<string, unknown>) {
          const cfg = readBarcodeConfig(this)
          const attrs = { ...this.getAttrToHTML(o as never) } as Record<string, unknown>
          for (const k of ["data-doc-barcode", "data-jinja-attr-src", "src", "class", "style", "alt"]) delete attrs[k]
          return barcodeDesignHtml(cfg, attrString(attrs))
        },
      },
      view: {
        init(this: { listenTo: (...a: unknown[]) => void; model: Component; render: () => void }) {
          this.listenTo(this.model, "change:attributes doc:refresh", this.render)
        },
        onRender(this: unknown, { el, model }: { el: HTMLElement; model: Component }) {
          renderBarcode(el, model, store)
        },
      },
    })

    Components.addType(DOC_TYPES.raw, {
      isComponent: (el: HTMLElement) => (el?.nodeType === 1 && el.hasAttribute?.(ATTR_RAW) ? { type: DOC_TYPES.raw, components: [] } : undefined),
      model: {
        defaults: {
          name: "Advanced Jinja",
          icon: CMP_ICONS.raw,
          droppable: false,
          editable: false,
          textable: true,
          stylable: false,
          components: [],
        },
        toHTML(this: Component) {
          const tag = this.get("tagName") || "div"
          const attrs = { [ATTR_RAW]: this.getAttributes()[ATTR_RAW] ?? "" }
          return tag === "col" ? `<col${attrString(attrs)}>` : `<${tag}${attrString(attrs)}></${tag}>`
        },
      },
      view: {
        init(this: { listenTo: (...a: unknown[]) => void; model: Component; render: () => void }) {
          this.listenTo(this.model, "change:attributes", this.render)
        },
        onRender(this: unknown, { el, model }: { el: HTMLElement; model: Component }) {
          renderRaw(el, model)
        },
      },
    })

    Components.addType(DOC_TYPES.region, {
      isComponent: (el: HTMLElement) => (el?.nodeType === 1 && el.hasAttribute?.("data-doc-region") ? { type: DOC_TYPES.region } : undefined),
      model: {
        defaults: {
          tagName: "div",
          name: "Колонтитул",
          icon: CMP_ICONS.region,
          droppable: true,
          attributes: { class: "doc-region doc-region-header", "data-doc-region": "header", "data-doc-repeat": "all" },
        },
      },
    })

    Components.addType(DOC_TYPES.pageBreak, {
      isComponent: (el: HTMLElement) => (el?.nodeType === 1 && el.classList?.contains("doc-page-break") ? { type: DOC_TYPES.pageBreak } : undefined),
      model: {
        defaults: { tagName: "div", name: "Разрыв страницы", icon: CMP_ICONS.pageBreak, droppable: false, stylable: false, attributes: { class: "doc-page-break" } },
      },
    })

    registerBlocks(editor)
    registerNaming(editor)

    const refreshAll = () => {
      const wrapper = editor.getWrapper()
      if (!wrapper) return
      const doc = editor.Canvas.getDocument()
      if (doc?.documentElement) doc.documentElement.setAttribute("data-doc-mode", store.get().mode)
      const walk = (c: Component) => {
        const type = c.get("type")
        if (type === DOC_TYPES.variable || type === DOC_TYPES.table || type === DOC_TYPES.barcode) c.trigger("doc:refresh")
        decorate(c, store)
        c.components().forEach(walk)
      }
      wrapper.components().forEach(walk)
    }

    const applySheet = () => {
      const { page } = store.get()
      const { width } = pageSizeMm(page)
      const dm = editor.Devices
      const device = dm.get("doc-sheet")
      const props = { id: "doc-sheet", name: "Лист", width: `${mmToPx(width)}px`, widthMedia: "" }
      if (device) device.set(props)
      else dm.add(props)
      editor.setDevice("doc-sheet")
      const doc = editor.Canvas.getDocument()
      if (!doc) return
      let style = doc.getElementById("doc-sheet-css") as HTMLStyleElement | null
      if (!style) {
        style = doc.createElement("style")
        style.id = "doc-sheet-css"
        doc.head.appendChild(style)
      }
      // Базовый CSS документа на холсте тот же, что и в шаблоне: шрифт, поля, таблицы.
      style.textContent = `${baseCanvasCss(store)}\n${sheetGuidesCss(store)}`
      doc.documentElement.setAttribute("data-doc-mode", store.get().mode)
    }

    let lastMode = store.get().mode
    let lastData = store.get().sampleData
    let lastSchema = store.get().schema
    let lastPage = store.get().page
    store.subscribe(() => {
      const s = store.get()
      if (s.page !== lastPage) {
        const orientationChanged = s.page.orientation !== lastPage.orientation || s.page.format !== lastPage.format || s.page.widthMm !== lastPage.widthMm
        lastPage = s.page
        applySheet()
        if (orientationChanged) setTimeout(fitZoom, 50)
      }
      if (s.mode !== lastMode || s.sampleData !== lastData || s.schema !== lastSchema) {
        lastMode = s.mode
        lastData = s.sampleData
        lastSchema = s.schema
        refreshAll()
      }
    })

    editor.on("canvas:frame:load", () => {
      applySheet()
      setTimeout(refreshAll, 0)
    })
    editor.on("component:mount", (c: Component) => decorate(c, store))
    editor.on("component:update:attributes", (c: Component) => {
      decorate(c, store)
      // Директивы влияют на подписи и значения переменных внутри.
      const attrs = c.getAttributes()
      if (ATTR_FOR in attrs || ATTR_IF in attrs) {
        const walk = (x: Component) => {
          if (x.get("type") === DOC_TYPES.variable || x.get("type") === DOC_TYPES.table || x.get("type") === DOC_TYPES.barcode) x.trigger("doc:refresh")
          decorate(x, store)
          x.components().forEach(walk)
        }
        c.components().forEach(walk)
      }
    })
    editor.on("component:add", (c: Component) => setTimeout(() => decorate(c, store), 0))
    editor.on("page:select", () => setTimeout(() => {
      applySheet()
      refreshAll()
    }, 0))
    editor.on("component:selected component:deselected", () => store.set((s) => ({ selectionTick: s.selectionTick + 1 })))
    editor.on("component:update", () => store.set((s) => ({ selectionTick: s.selectionTick + 1 })))

    /** Лист целиком по ширине холста (не больше 100%). */
    const fitZoom = () => {
      let applied = 100
      editor.Canvas.fitViewport({
        ignoreHeight: true,
        gap: 32,
        zoom: (z: number) => {
          applied = Math.max(50, Math.min(100, Math.floor(z)))
          return applied
        },
      })
      store.set({ zoom: applied })
    }
    editor.Commands.add("doc:fit-zoom", { run: () => fitZoom() })
    editor.Commands.add("doc:refresh", { run: () => refreshAll() })
    editor.Commands.add("doc:apply-sheet", { run: () => applySheet() })
  }
}

function baseCanvasCss(store: DesignerStore): string {
  const { page } = store.get()
  const m = page.margins
  return `body { margin: 0; padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; color: ${page.font.color}; font-family: ${page.font.family}; font-size: ${page.font.sizePt}pt; line-height: ${page.font.lineHeight}; box-sizing: border-box; }
*, *::before, *::after { box-sizing: border-box; }
p { margin: 0 0 2mm; }
h1, h2, h3 { margin: 0 0 3mm; line-height: 1.2; }
h1 { font-size: 16pt; } h2 { font-size: 13pt; } h3 { font-size: 11pt; }
img { max-width: 100%; }
table { border-collapse: collapse; width: 100%; }`
}

const BLOCK_CATEGORIES = {
  basic: { id: "basic", label: "Основные", order: 1 },
  layout: { id: "layout", label: "Макет", order: 2 },
  data: { id: "data", label: "Данные", order: 3 },
  industrial: { id: "industrial", label: "Коды и реквизиты", order: 4 },
  advanced: { id: "advanced", label: "Advanced", order: 5 },
}

function v(expr: string): string {
  return `<span ${ATTR_VAR}="${escapeAttr(expr)}"></span>`
}

function registerBlocks(editor: Editor) {
  const bm = editor.Blocks
  const add = (id: string, label: string, category: keyof typeof BLOCK_CATEGORIES, content: unknown, media: string) =>
    bm.add(id, { label, category: BLOCK_CATEGORIES[category], content: content as never, media, select: true, activate: false })

  add("doc-text", "Текст", "basic", { type: "text", tagName: "p", content: "Введите текст" }, BLOCK_ICONS.text)
  add("doc-heading", "Заголовок", "basic", { type: "text", tagName: "h1", content: "Заголовок документа", attributes: { class: "doc-title" } }, BLOCK_ICONS.heading)
  add(
    "doc-paragraph",
    "Абзац",
    "basic",
    { type: "text", tagName: "p", content: "Настоящим подтверждаем передачу товара по документу.", style: { "text-align": "justify" } },
    BLOCK_ICONS.paragraph
  )
  add("doc-image", "Изображение", "basic", { type: "image", style: { width: "40mm" }, activate: true }, BLOCK_ICONS.image)
  add("doc-divider", "Разделитель", "basic", { tagName: "hr", attributes: { class: "doc-divider" }, name: "Разделитель", droppable: false }, BLOCK_ICONS.divider)
  add("doc-spacer", "Отступ", "basic", { tagName: "div", attributes: { class: "doc-spacer" }, name: "Отступ", droppable: false }, BLOCK_ICONS.spacer)
  add(
    "doc-table-basic",
    "Таблица",
    "basic",
    `<table class="doc-basic-table" style="width:100%;border-collapse:collapse">
      <tbody>
        <tr><td style="border:0.75pt solid #333;padding:1.5mm">Ячейка</td><td style="border:0.75pt solid #333;padding:1.5mm">Ячейка</td><td style="border:0.75pt solid #333;padding:1.5mm">Ячейка</td></tr>
        <tr><td style="border:0.75pt solid #333;padding:1.5mm">Ячейка</td><td style="border:0.75pt solid #333;padding:1.5mm">Ячейка</td><td style="border:0.75pt solid #333;padding:1.5mm">Ячейка</td></tr>
      </tbody>
    </table>`,
    BLOCK_ICONS.table
  )

  add("doc-container", "Контейнер", "layout", { tagName: "div", name: "Контейнер", style: { padding: "2mm", "min-height": "10mm" } }, BLOCK_ICONS.container)
  add(
    "doc-cols-2",
    "Две колонки",
    "layout",
    `<div class="doc-cols"><div class="doc-col"><p>Левая колонка</p></div><div class="doc-col"><p>Правая колонка</p></div></div>`,
    BLOCK_ICONS.cols2
  )
  add(
    "doc-cols-3",
    "Три колонки",
    "layout",
    `<div class="doc-cols"><div class="doc-col"><p>Колонка 1</p></div><div class="doc-col"><p>Колонка 2</p></div><div class="doc-col"><p>Колонка 3</p></div></div>`,
    BLOCK_ICONS.cols3
  )
  add(
    "doc-header",
    "Колонтитул",
    "layout",
    { type: DOC_TYPES.region, components: `<div class="doc-small">${v("organization.name")}</div>` },
    BLOCK_ICONS.header
  )
  add(
    "doc-footer-pages",
    "Нижний колонтитул",
    "layout",
    {
      type: DOC_TYPES.region,
      attributes: { class: "doc-region doc-region-footer", "data-doc-region": "footer", "data-doc-repeat": "all" },
      components: `<div style="text-align:right">Страница ${v("page.number")} из ${v("page.total")}</div>`,
    },
    BLOCK_ICONS.footer
  )
  add("doc-page-break", "Разрыв страницы", "layout", { type: DOC_TYPES.pageBreak }, BLOCK_ICONS.pageBreak)

  add("doc-variable", "Переменная", "data", { type: DOC_TYPES.variable, attributes: { [ATTR_VAR]: "document.number" }, activate: true }, BLOCK_ICONS.variable)
  add(
    "doc-condition",
    "Условие",
    "data",
    `<div ${ATTR_IF}="document.comment" style="padding:2mm 0"><p>Комментарий: ${v("document.comment")}</p></div>`,
    BLOCK_ICONS.condition
  )
  add(
    "doc-condition-else",
    "Условие с «иначе»",
    "data",
    `<div ${ATTR_WRAP}="if"><div ${ATTR_BRANCH}="if" ${ATTR_COND}="document.status == &quot;APPROVED&quot;"><p>Документ утверждён</p></div><div ${ATTR_BRANCH}="else"><p>Документ не утверждён</p></div></div>`,
    BLOCK_ICONS.conditionElse
  )
  add(
    "doc-loop",
    "Повторяющийся блок",
    "data",
    `<div ${ATTR_FOR}="item in document.items" style="padding:1mm 0"><p>${v("loop.index")}. ${v("item.name")} — ${v("item.quantity | number")} ${v("item.unit")}</p></div>`,
    BLOCK_ICONS.loop
  )
  add("doc-data-table", "Таблица данных", "data", { type: DOC_TYPES.table, activate: true }, BLOCK_ICONS.dataTable)

  add("doc-qr", "QR-код", "industrial", { type: DOC_TYPES.barcode, attributes: { "data-doc-barcode": JSON.stringify(normalizeBarcodeBlock({ kind: "qrcode", expr: "document.url", sizeMm: 25 })) } }, BLOCK_ICONS.qr)
  add(
    "doc-barcode",
    "Штрихкод",
    "industrial",
    { type: DOC_TYPES.barcode, attributes: { "data-doc-barcode": JSON.stringify(normalizeBarcodeBlock({ kind: "code128", expr: "document.number", sizeMm: 25, humanReadable: true })) } },
    BLOCK_ICONS.barcode
  )
  add(
    "doc-datamatrix",
    "DataMatrix",
    "industrial",
    { type: DOC_TYPES.barcode, attributes: { "data-doc-barcode": JSON.stringify(normalizeBarcodeBlock({ kind: "gs1datamatrix", expr: "document.items[0].marking_code", sizeMm: 20 })) } },
    BLOCK_ICONS.datamatrix
  )
  add("doc-number", "Номер документа", "industrial", `<h1 class="doc-title">Документ № ${v("document.number")} от ${v("document.date | date")}</h1>`, BLOCK_ICONS.number)
  add("doc-date", "Дата", "industrial", `<p>${v("document.date | date(\"D MMMM YYYY\")")} г.</p>`, BLOCK_ICONS.date)
  add(
    "doc-requisites",
    "Реквизиты компании",
    "industrial",
    `<div class="doc-requisites"><b>${v("organization.name")}</b><br>ИНН ${v("organization.inn")} / КПП ${v("organization.kpp")}<br>${v("organization.address")}<br>р/с ${v("organization.account")} в ${v("organization.bank_name")}, БИК ${v("organization.bik")}</div>`,
    BLOCK_ICONS.requisites
  )
  add(
    "doc-signature",
    "Подпись",
    "industrial",
    `<div class="doc-signature"><span class="doc-signature-role">Ответственный</span><span class="doc-signature-line"></span><span class="doc-signature-name">/ ${v("organization.responsible")} /</span></div>`,
    BLOCK_ICONS.signature
  )
  add("doc-stamp", "Место печати", "industrial", `<div class="doc-stamp">М.П.</div>`, BLOCK_ICONS.stamp)

  add("doc-raw", "Jinja-блок", "advanced", { type: DOC_TYPES.raw, tagName: "div", attributes: { [ATTR_RAW]: "{% set total = 0 %}" } }, BLOCK_ICONS.raw)
}

/** Структура документа понятными словами вместо тегов HTML. */
function registerNaming(editor: Editor) {
  const TAG_NAMES: Record<string, string> = {
    p: "Абзац",
    h1: "Заголовок",
    h2: "Подзаголовок",
    h3: "Подзаголовок",
    span: "Фрагмент",
    b: "Жирный",
    strong: "Жирный",
    img: "Изображение",
    table: "Таблица",
    thead: "Шапка таблицы",
    tbody: "Строки",
    tfoot: "Итоги",
    tr: "Строка",
    td: "Ячейка",
    th: "Ячейка шапки",
    hr: "Разделитель",
    ul: "Список",
    ol: "Список",
    li: "Пункт",
    section: "Раздел",
    br: "Перенос строки",
  }
  const CLASS_NAMES: Record<string, string> = {
    "doc-cols": "Колонки",
    "doc-col": "Колонка",
    "doc-signature": "Подпись",
    "doc-stamp": "Место печати",
    "doc-requisites": "Реквизиты",
    "doc-title": "Заголовок",
    "doc-spacer": "Отступ",
    "doc-divider": "Разделитель",
  }
  const nameFor = (c: Component): string | null => {
    const attrs = c.getAttributes()
    if (attrs[ATTR_WRAP] === "for" || (attrs[ATTR_FOR] && !attrs[ATTR_WRAP])) return "Повторяющийся блок"
    if (attrs[ATTR_WRAP] === "if" || attrs[ATTR_IF]) return "Условный блок"
    if (attrs[ATTR_BRANCH]) return attrs[ATTR_BRANCH] === "else" ? "Иначе" : "Вариант условия"
    if (attrs["data-doc-region"]) return attrs["data-doc-region"] === "header" ? "Верхний колонтитул" : "Нижний колонтитул"
    for (const cls of c.getClasses()) if (CLASS_NAMES[cls as string]) return CLASS_NAMES[cls as string]
    const tag = String(c.get("tagName") || "").toLowerCase()
    if (c.get("type") === "text") return TAG_NAMES[tag] ?? "Текст"
    if (c.get("type") === "textnode") return null
    return TAG_NAMES[tag] ?? (tag === "div" ? "Блок" : null)
  }
  const apply = (c: Component) => {
    if (!c.get("name") || c.get("__docAutoName")) {
      const n = nameFor(c)
      if (n) c.set({ name: n, __docAutoName: true }, { silent: true } as never)
    }
    c.components().forEach(apply)
  }
  editor.on("component:add", (c: Component) => apply(c))
  editor.on("component:update:attributes", (c: Component) => apply(c))
  editor.on("load", () => {
    editor.Pages.getAll().forEach((p) => {
      const root = p.getMainComponent()
      root.set({ name: "Документ" }, { silent: true } as never)
      root.components().forEach(apply)
    })
  })
}

export { isLinearBarcode }
