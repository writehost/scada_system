/**
 * Параметры листа. Логически храним миллиметры, в CSS выводим мм/pt —
 * Chromium одинаково переводит их и на холсте, и при печати в PDF.
 */

export type PageFormat = "A4" | "A5" | "Letter" | "Custom"
export type PageOrientation = "portrait" | "landscape"

export type PageMargins = { top: number; right: number; bottom: number; left: number }

export type PageSettings = {
  format: PageFormat
  orientation: PageOrientation
  /** Для Custom; для стандартных форматов вычисляются. Всегда в книжной ориентации. */
  widthMm: number
  heightMm: number
  margins: PageMargins
  font: {
    family: string
    sizePt: number
    lineHeight: number
    color: string
  }
  background: string
}

export const PAGE_FORMATS: Record<Exclude<PageFormat, "Custom">, { label: string; widthMm: number; heightMm: number }> = {
  A4: { label: "A4 · 210 × 297 мм", widthMm: 210, heightMm: 297 },
  A5: { label: "A5 · 148 × 210 мм", widthMm: 148, heightMm: 210 },
  Letter: { label: "Letter · 216 × 279 мм", widthMm: 215.9, heightMm: 279.4 },
}

export const FONT_FAMILIES = [
  { id: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { id: "Arial, Helvetica, sans-serif", label: "Arial" },
  { id: "'PT Sans', Arial, sans-serif", label: "PT Sans" },
  { id: "'PT Serif', 'Times New Roman', serif", label: "PT Serif" },
  { id: "Calibri, Arial, sans-serif", label: "Calibri" },
  { id: "'Courier New', Courier, monospace", label: "Courier New" },
]

export const DEFAULT_PAGE: PageSettings = {
  format: "A4",
  orientation: "portrait",
  widthMm: 210,
  heightMm: 297,
  margins: { top: 15, right: 15, bottom: 15, left: 20 },
  font: { family: "Arial, Helvetica, sans-serif", sizePt: 10, lineHeight: 1.35, color: "#111111" },
  background: "#ffffff",
}

function num(v: unknown, fallback: number, min = 0, max = 2000): number {
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

export function normalizePage(input: unknown): PageSettings {
  const src = (input && typeof input === "object" ? input : {}) as Partial<PageSettings>
  const format: PageFormat = src.format && ["A4", "A5", "Letter", "Custom"].includes(src.format) ? src.format : "A4"
  const orientation: PageOrientation = src.orientation === "landscape" ? "landscape" : "portrait"
  const base = format === "Custom" ? null : PAGE_FORMATS[format]
  const m = (src.margins ?? {}) as Partial<PageMargins>
  const f = (src.font ?? {}) as Partial<PageSettings["font"]>
  return {
    format,
    orientation,
    widthMm: base ? base.widthMm : num(src.widthMm, 210, 30, 1200),
    heightMm: base ? base.heightMm : num(src.heightMm, 297, 30, 1200),
    margins: {
      top: num(m.top, DEFAULT_PAGE.margins.top, 0, 100),
      right: num(m.right, DEFAULT_PAGE.margins.right, 0, 100),
      bottom: num(m.bottom, DEFAULT_PAGE.margins.bottom, 0, 100),
      left: num(m.left, DEFAULT_PAGE.margins.left, 0, 100),
    },
    font: {
      family: typeof f.family === "string" && f.family.trim() ? f.family : DEFAULT_PAGE.font.family,
      sizePt: num(f.sizePt, DEFAULT_PAGE.font.sizePt, 5, 72),
      lineHeight: num(f.lineHeight, DEFAULT_PAGE.font.lineHeight, 0.8, 3),
      color: typeof f.color === "string" && /^#[0-9a-f]{3,8}$/i.test(f.color) ? f.color : DEFAULT_PAGE.font.color,
    },
    background: typeof src.background === "string" && /^#[0-9a-f]{3,8}$/i.test(src.background) ? src.background : "#ffffff",
  }
}

/** Размер листа с учётом ориентации, мм. */
export function pageSizeMm(page: PageSettings): { width: number; height: number } {
  const w = page.widthMm
  const h = page.heightMm
  return page.orientation === "landscape" ? { width: Math.max(w, h), height: Math.min(w, h) } : { width: Math.min(w, h), height: Math.max(w, h) }
}

export const MM_TO_PX = 96 / 25.4

export function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_PX * 100) / 100
}

export function describePage(page: PageSettings): string {
  const { width, height } = pageSizeMm(page)
  const name = page.format === "Custom" ? `${Math.round(width)} × ${Math.round(height)} мм` : page.format
  return `${name} ${page.orientation === "landscape" ? "альбомная" : "книжная"}`
}

/**
 * Базовый CSS документа: одинаков для холста, HTML-предпросмотра и PDF.
 * Холст добавляет только визуальные поля и тень листа.
 */
export function documentBaseCss(page: PageSettings): string {
  const { width, height } = pageSizeMm(page)
  const m = page.margins
  return `@page { size: ${width}mm ${height}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: ${page.background}; color: ${page.font.color}; font-family: ${page.font.family}; font-size: ${page.font.sizePt}pt; line-height: ${page.font.lineHeight}; }
*, *::before, *::after { box-sizing: border-box; }
p { margin: 0 0 2mm; }
h1, h2, h3 { margin: 0 0 3mm; line-height: 1.2; }
h1 { font-size: 16pt; } h2 { font-size: 13pt; } h3 { font-size: 11pt; }
img { max-width: 100%; }
table { border-collapse: collapse; width: 100%; }
thead { display: table-header-group; }
/* Итоги — только в конце таблицы, а не внизу каждого листа. */
tfoot { display: table-row-group; }
.doc-page { position: relative; }
.doc-page + .doc-page { break-before: page; page-break-before: always; }
.doc-page-break { break-after: page; page-break-after: always; height: 0; border: 0; margin: 0; }
.doc-avoid-break { break-inside: avoid; page-break-inside: avoid; }
.doc-table.doc-rows-nobreak tr { break-inside: avoid; page-break-inside: avoid; }
.doc-table.doc-no-repeat-head thead { display: table-row-group; }
.doc-var-empty { color: #b91c1c; }
@media screen {
  body { padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
}`
}

export type RegionRepeat = "all" | "first" | "last"
