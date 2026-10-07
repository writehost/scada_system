import { ATTR_FOR, ATTR_VAR, escapeAttr, escapeText } from "./jinja/markers.ts"
import { getPath } from "./jinja/expressions.ts"
import { evaluatePreview, loopScope, type PreviewScope } from "./preview-eval.ts"

/**
 * «Таблица данных»: шапка, строка-шаблон с циклом и итоговая строка.
 * Описывается конфигом; из него строятся и превью на холсте, и разметка для Jinja-экспорта.
 */

export type ColumnAlign = "left" | "center" | "right"
export type ColumnFormat = "" | "number" | "money" | "date"

export type DataTableColumn = {
  id: string
  label: string
  /** Выражение относительно элемента: `item.name`, `loop.index`. */
  expr: string
  /** Ширина: `12mm`, `20%` или пусто (авто). */
  width: string
  align: ColumnAlign
  format: ColumnFormat
}

export type DataTableConfig = {
  source: string
  itemVar: string
  columns: DataTableColumn[]
  header: { show: boolean; background: string; color: string; bold: boolean }
  borders: "all" | "horizontal" | "outer" | "none"
  borderColor: string
  borderWidthPt: number
  paddingMm: number
  fontSizePt: number | null
  zebra: boolean
  repeatHeader: boolean
  avoidRowSplit: boolean
  /** Итоговая строка: на колонку — текст или выражение. */
  totals: { show: boolean; bold: boolean; cells: Record<string, { text?: string; expr?: string }> }
  emptyText: string
}

export function newColumnId(): string {
  return `c${Math.random().toString(36).slice(2, 8)}`
}

export function defaultDataTable(source = "document.items", itemVar = "item"): DataTableConfig {
  return {
    source,
    itemVar,
    columns: [
      { id: "c_no", label: "№", expr: "loop.index", width: "10mm", align: "center", format: "" },
      { id: "c_name", label: "Наименование", expr: `${itemVar}.name`, width: "", align: "left", format: "" },
    ],
    header: { show: true, background: "#f1f5f9", color: "#111111", bold: true },
    borders: "all",
    borderColor: "#333333",
    borderWidthPt: 0.75,
    paddingMm: 1.5,
    fontSizePt: null,
    zebra: false,
    repeatHeader: true,
    avoidRowSplit: true,
    totals: { show: false, bold: true, cells: {} },
    emptyText: "",
  }
}

function str(v: unknown, d: string): string {
  return typeof v === "string" ? v : d
}

export function normalizeDataTable(input: unknown): DataTableConfig {
  const base = defaultDataTable()
  const src = (input && typeof input === "object" ? input : {}) as Partial<DataTableConfig>
  const cols = Array.isArray(src.columns) ? src.columns : base.columns
  return {
    source: str(src.source, base.source),
    itemVar: /^[A-Za-z_]\w*$/.test(str(src.itemVar, "")) ? (src.itemVar as string) : base.itemVar,
    columns: cols.map((c) => ({
      id: str(c?.id, newColumnId()),
      label: str(c?.label, ""),
      expr: str(c?.expr, ""),
      width: /^(\d+(\.\d+)?(mm|%|pt))?$/.test(str(c?.width, "")) ? str(c?.width, "") : "",
      align: c?.align === "center" || c?.align === "right" ? c.align : "left",
      format: c?.format === "number" || c?.format === "money" || c?.format === "date" ? c.format : "",
    })),
    header: { ...base.header, ...(src.header ?? {}) },
    borders: src.borders === "horizontal" || src.borders === "outer" || src.borders === "none" ? src.borders : "all",
    borderColor: str(src.borderColor, base.borderColor),
    borderWidthPt: typeof src.borderWidthPt === "number" ? src.borderWidthPt : base.borderWidthPt,
    paddingMm: typeof src.paddingMm === "number" ? src.paddingMm : base.paddingMm,
    fontSizePt: typeof src.fontSizePt === "number" ? src.fontSizePt : null,
    zebra: !!src.zebra,
    repeatHeader: src.repeatHeader !== false,
    avoidRowSplit: src.avoidRowSplit !== false,
    totals: {
      show: !!src.totals?.show,
      bold: src.totals?.bold !== false,
      cells: src.totals?.cells && typeof src.totals.cells === "object" ? src.totals.cells : {},
    },
    emptyText: str(src.emptyText, ""),
  }
}

function withFormat(expr: string, format: ColumnFormat): string {
  if (!format || /\|\s*(number|money|date)\b/.test(expr)) return expr
  return `${expr} | ${format}`
}

function safeColor(c: string, fallback: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback
}

function cellStyle(cfg: DataTableConfig, col: DataTableColumn | null, kind: "th" | "td" | "tf", rowIndex = 0): string {
  const b = `${cfg.borderWidthPt}pt solid ${safeColor(cfg.borderColor, "#333333")}`
  const parts = [`padding:${cfg.paddingMm}mm`, `vertical-align:top`]
  if (col) parts.push(`text-align:${col.align}`)
  if (cfg.borders === "all") parts.push(`border:${b}`)
  if (cfg.borders === "horizontal") parts.push(`border-top:${b}`, `border-bottom:${b}`)
  if (kind === "th") {
    if (cfg.header.background) parts.push(`background:${safeColor(cfg.header.background, "#f1f5f9")}`)
    parts.push(`color:${safeColor(cfg.header.color, "#111111")}`, `font-weight:${cfg.header.bold ? 700 : 400}`)
  }
  if (kind === "tf" && cfg.totals.bold) parts.push("font-weight:700")
  if (kind === "td" && cfg.zebra && rowIndex % 2 === 1) parts.push("background:#f8fafc")
  return parts.join(";")
}

function tableStyle(cfg: DataTableConfig): string {
  const parts = ["width:100%", "border-collapse:collapse"]
  if (cfg.fontSizePt) parts.push(`font-size:${cfg.fontSizePt}pt`)
  if (cfg.borders === "outer") parts.push(`border:${cfg.borderWidthPt}pt solid ${safeColor(cfg.borderColor, "#333333")}`)
  return parts.join(";")
}

function tableClasses(cfg: DataTableConfig, extra = ""): string {
  return ["doc-table", cfg.avoidRowSplit ? "doc-rows-nobreak" : "", cfg.repeatHeader ? "" : "doc-no-repeat-head", extra].filter(Boolean).join(" ")
}

function colgroup(cfg: DataTableConfig): string {
  if (!cfg.columns.some((c) => c.width)) return ""
  return `<colgroup>${cfg.columns.map((c) => (c.width ? `<col style="width:${c.width}">` : "<col>")).join("")}</colgroup>`
}

/** Разметка для экспорта: строка с data-jinja-for, ячейки с data-jinja-var. */
export function dataTableDesignHtml(cfg: DataTableConfig, extraAttrs = ""): string {
  const thead = cfg.header.show
    ? `<thead><tr>${cfg.columns.map((c) => `<th style="${cellStyle(cfg, c, "th")}">${escapeText(c.label)}</th>`).join("")}</tr></thead>`
    : ""
  const cells = cfg.columns
    .map((c) => {
      const expr = withFormat(c.expr.trim(), c.format)
      const content = expr ? `<span ${ATTR_VAR}="${escapeAttr(expr)}"></span>` : ""
      return `<td style="${cellStyle(cfg, c, "td")}">${content}</td>`
    })
    .join("")
  const header = `${cfg.itemVar} in ${cfg.source}`
  let tbody = `<tbody><tr ${ATTR_FOR}="${escapeAttr(header)}">${cells}</tr></tbody>`
  if (cfg.emptyText.trim()) {
    tbody = `<tbody><tr ${ATTR_FOR}="${escapeAttr(header)}">${cells}</tr><tr data-jinja-if="${escapeAttr(`not ${cfg.source}`)}"><td colspan="${cfg.columns.length}" style="${cellStyle(cfg, null, "td")}">${escapeText(cfg.emptyText)}</td></tr></tbody>`
  }
  const tfoot = cfg.totals.show
    ? `<tfoot><tr>${cfg.columns
        .map((c) => {
          const cell = cfg.totals.cells[c.id] ?? {}
          const content = cell.expr?.trim()
            ? `<span ${ATTR_VAR}="${escapeAttr(withFormat(cell.expr.trim(), c.format))}"></span>`
            : escapeText(cell.text ?? "")
          return `<td style="${cellStyle(cfg, c, "tf")}">${content}</td>`
        })
        .join("")}</tr></tfoot>`
    : ""
  return `<table class="${tableClasses(cfg)}" style="${tableStyle(cfg)}" data-doc-table="${escapeAttr(JSON.stringify(cfg))}"${extraAttrs}>${colgroup(cfg)}${thead}${tbody}${tfoot}</table>`
}

function chip(label: string): string {
  return `<span class="doc-chip">◇ ${escapeText(label)}</span>`
}

/**
 * Превью на холсте. В режиме DESIGN — строка-шаблон с переменными,
 * в режиме DATA PREVIEW — реальные строки из тестовых данных.
 */
export function dataTablePreviewHtml(
  cfg: DataTableConfig,
  opts: { mode: "design" | "data"; scope: PreviewScope; labelFor: (expr: string) => string; maxRows?: number }
): string {
  const thead = cfg.header.show
    ? `<thead><tr>${cfg.columns.map((c) => `<th style="${cellStyle(cfg, c, "th")}">${escapeText(c.label)}</th>`).join("")}</tr></thead>`
    : ""
  const valueCell = (c: DataTableColumn, scope: PreviewScope) => {
    const expr = withFormat(c.expr.trim(), c.format)
    if (!expr) return ""
    const v = evaluatePreview(expr, scope)
    return escapeText(v.ok ? v.text : expr)
  }
  let rows = ""
  if (opts.mode === "design") {
    rows = `<tr class="doc-table-template-row">${cfg.columns
      .map((c) => `<td style="${cellStyle(cfg, c, "td")}">${c.expr.trim() ? chip(opts.labelFor(c.expr.trim())) : ""}</td>`)
      .join("")}</tr>`
    rows += `<tr class="doc-table-loop-hint"><td colspan="${Math.max(cfg.columns.length, 1)}">↻ повторяется для каждого элемента: ${escapeText(opts.labelFor(cfg.source))}</td></tr>`
  } else {
    const list = getPath(opts.scope, cfg.source)
    const items = Array.isArray(list) ? list : []
    const limit = opts.maxRows ?? 200
    rows = items
      .slice(0, limit)
      .map((_, i) => {
        const { scope } = loopScope(opts.scope, cfg.itemVar, cfg.source, i)
        return `<tr>${cfg.columns.map((c) => `<td style="${cellStyle(cfg, c, "td", i)}">${valueCell(c, scope)}</td>`).join("")}</tr>`
      })
      .join("")
    if (items.length > limit) rows += `<tr><td colspan="${cfg.columns.length}" style="text-align:center;color:#64748b">… ещё ${items.length - limit}</td></tr>`
    if (!items.length) {
      rows = `<tr><td colspan="${cfg.columns.length}" style="${cellStyle(cfg, null, "td")};color:#64748b">${escapeText(cfg.emptyText || "Нет строк в тестовых данных")}</td></tr>`
    }
  }
  const tfoot = cfg.totals.show
    ? `<tfoot><tr>${cfg.columns
        .map((c) => {
          const cell = cfg.totals.cells[c.id] ?? {}
          let content = escapeText(cell.text ?? "")
          if (cell.expr?.trim()) {
            const expr = withFormat(cell.expr.trim(), c.format)
            if (opts.mode === "design") content = chip(opts.labelFor(cell.expr.trim()))
            else {
              const v = evaluatePreview(expr, opts.scope)
              content = escapeText(v.ok ? v.text : expr)
            }
          }
          return `<td style="${cellStyle(cfg, c, "tf")}">${content}</td>`
        })
        .join("")}</tr></tfoot>`
    : ""
  return `<table class="${tableClasses(cfg)}" style="${tableStyle(cfg)}">${colgroup(cfg)}${thead}<tbody>${rows}</tbody>${tfoot}</table>`
}
