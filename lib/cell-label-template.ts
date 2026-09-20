/** Шаблон этикетки ячейки: размер, текстовые блоки с переменными. QR — из «Внешний вид». */

import { explainLocationCode } from "@/lib/location-code-help"
import {
  buildSlotTitle,
  slotLabel,
  warehouseDisplayLabel,
  zoneDisplayLabel,
  type StorageSlotProfile,
} from "@/lib/storage-slot-ui"

export const CELL_LABEL_TEMPLATE_STORAGE_KEY = "wms.cellLabelTemplate"
export const CELL_LABEL_TEMPLATE_EVENT = "wms-cell-label-template"

export type CellLabelTextAlign = "left" | "center" | "right"
export type CellLabelFontWeight = "normal" | "bold" | "mono"
export type CellLabelBlockPlacement = "before" | "after"

export type CellLabelTextBlock = {
  id: string
  template: string
  fontSizePt: number
  fontWeight: CellLabelFontWeight
  align: CellLabelTextAlign
  placement: CellLabelBlockPlacement
  visible: boolean
}

export type CellLabelTemplate = {
  widthMm: number
  heightMm: number
  marginMm: number
  qrSizeMm: number
  showQr: boolean
  textBlocks: CellLabelTextBlock[]
}

export type CellLabelVariableDef = {
  key: string
  label: string
  hint: string
  example: string
}

export const CELL_LABEL_SIZE_PRESETS = [
  { id: "30x20", label: "30 × 20", widthMm: 30, heightMm: 20 },
  { id: "40x30", label: "40 × 30", widthMm: 40, heightMm: 30 },
  { id: "43x25", label: "43 × 25", widthMm: 43, heightMm: 25 },
  { id: "50x30", label: "50 × 30", widthMm: 50, heightMm: 30 },
  { id: "58x30", label: "58 × 30", widthMm: 58, heightMm: 30 },
  { id: "58x40", label: "58 × 40", widthMm: 58, heightMm: 40 },
  { id: "75x50", label: "75 × 50", widthMm: 75, heightMm: 50 },
  { id: "80x50", label: "80 × 50", widthMm: 80, heightMm: 50 },
  { id: "100x50", label: "100 × 50", widthMm: 100, heightMm: 50 },
  { id: "100x70", label: "100 × 70", widthMm: 100, heightMm: 70 },
  { id: "100x100", label: "100 × 100", widthMm: 100, heightMm: 100 },
  { id: "100x150", label: "100 × 150", widthMm: 100, heightMm: 150 },
  { id: "105x148", label: "A6 · 105 × 148", widthMm: 105, heightMm: 148 },
  { id: "148x210", label: "A5 · 148 × 210", widthMm: 148, heightMm: 210 },
  { id: "210x297", label: "A4 · 210 × 297", widthMm: 210, heightMm: 297 },
] as const

export const CELL_LABEL_SIZE_MIN = { widthMm: 15, heightMm: 10, qrSizeMm: 8, marginMm: 0 }
export const CELL_LABEL_SIZE_MAX = { widthMm: 320, heightMm: 450, qrSizeMm: 200, marginMm: 30 }

export function parseMmInput(raw: string): number | null {
  const cleaned = String(raw).trim().replace(",", ".")
  if (!cleaned || cleaned === "." || cleaned === "-" || cleaned === "+") return null
  const n = Number(cleaned.replace(/[^\d.+-]/g, ""))
  return Number.isFinite(n) ? n : null
}

export function clampLabelMm(
  value: number,
  min: number,
  max: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

export const CELL_LABEL_VARIABLES: CellLabelVariableDef[] = [
  { key: "locationCode", label: "Код ячейки", hint: "Полный код для QR и печати", example: "ST-SER-RND-SLNG-15-A01-01" },
  { key: "displayName", label: "Название", hint: "Display name ячейки или заголовок", example: "Стикеры · сериализация · 1,5 л" },
  { key: "title", label: "Заголовок", hint: "Явный title (если передан)", example: "Ячейка A01-01" },
  { key: "subtitle", label: "Подзаголовок", hint: "Склад · зона одной строкой", example: "Склад материалов · ST-SER" },
  { key: "slotTitle", label: "Профиль слота", hint: "Материал / процесс / форма / группа / объём", example: "Стикеры / Сериализация / Круглые / 1,5 л / A01-01" },
  { key: "materialType", label: "Материал (код)", hint: "ST = стикеры, LB = этикетки…", example: "ST" },
  { key: "materialTypeLabel", label: "Материал (текст)", hint: "Расшифровка кода материала", example: "Стикеры" },
  { key: "processTypeLabel", label: "Процесс", hint: "SER, BAGG, STORE…", example: "Сериализация" },
  { key: "stickerShapeLabel", label: "Форма стикера", hint: "RND / SQR / RECT", example: "Круглые" },
  { key: "productGroupLabel", label: "Товарная группа", hint: "SLNG, SLGZ…", example: "Славда негаз" },
  { key: "volumeLabel", label: "Объём", hint: "15 = 1,5 л", example: "1,5 л" },
  { key: "physicalAddress", label: "Адрес полки", hint: "A01-01 — класс A часто = мелочь", example: "A01-01" },
  { key: "addressClass", label: "Класс адреса", hint: "Первая буква physicalAddress (A, B…)", example: "A" },
  { key: "warehouseName", label: "Склад", hint: "Человекочитаемое имя склада", example: "Склад материалов" },
  { key: "zoneName", label: "Зона", hint: "ST-SER → Стикеры / сериализация", example: "Стикеры / сериализация" },
  { key: "codeSummary", label: "Пояснение кода", hint: "Кратко, что означает код ячейки", example: "Код описывает, что и для чего хранится…" },
  { key: "codeHint", label: "Подсказка по коду", hint: "Рекомендация из справки кодов", example: "ST в начале — тип материала «стикеры»" },
]

function newBlock(
  template: string,
  opts?: Partial<Omit<CellLabelTextBlock, "id" | "template">>
): CellLabelTextBlock {
  return {
    id: `b-${Math.random().toString(36).slice(2, 9)}`,
    template,
    fontSizePt: opts?.fontSizePt ?? 9,
    fontWeight: opts?.fontWeight ?? "normal",
    align: opts?.align ?? "center",
    placement: opts?.placement ?? "before",
    visible: opts?.visible ?? true,
  }
}

export const DEFAULT_CELL_LABEL_TEMPLATE: CellLabelTemplate = {
  widthMm: 100,
  heightMm: 100,
  marginMm: 4,
  qrSizeMm: 42,
  showQr: true,
  textBlocks: [
    newBlock("{{displayName}}", { fontSizePt: 11, fontWeight: "bold", placement: "before" }),
    newBlock("{{slotTitle}}", { fontSizePt: 8, placement: "before" }),
    newBlock("{{zoneName}} · {{warehouseName}}", { fontSizePt: 7, placement: "before" }),
    newBlock("{{locationCode}}", { fontSizePt: 9, fontWeight: "mono", placement: "after" }),
  ],
}

export type CellLabelRenderContext = {
  locationCode: string
  displayName?: string | null
  title?: string | null
  subtitle?: string | null
  warehouseCode?: string | null
  zoneCode?: string | null
  slotProfile?: StorageSlotProfile | null
}

export const CELL_LABEL_DEMO_CONTEXT: CellLabelRenderContext = {
  locationCode: "ST-SER-RND-SLNG-15-A01-01",
  displayName: "Стикеры · сериализация · 1,5 л",
  title: "Стикеры · сериализация · 1,5 л",
  subtitle: "Склад материалов · ST-SER",
  warehouseCode: "OS",
  zoneCode: "ST-SER",
  slotProfile: {
    materialType: "ST",
    processType: "SER",
    stickerShape: "RND",
    productGroup: "SLNG",
    volume: "15",
    physicalAddress: "A01-01",
  },
}

function parseAddressClass(physicalAddress: string | null | undefined): string {
  const raw = String(physicalAddress ?? "").trim()
  if (!raw) return ""
  const m = raw.match(/^([A-Za-zА-Яа-я])/)
  return m?.[1]?.toUpperCase() ?? ""
}

export function buildCellLabelValues(ctx: CellLabelRenderContext): Record<string, string> {
  const profile = ctx.slotProfile ?? null
  const code = ctx.locationCode.trim()
  const explanation = explainLocationCode(code, {
    slotProfile: profile,
    warehouseCode: ctx.warehouseCode,
    zoneCode: ctx.zoneCode,
  })
  const physicalAddress = profile?.physicalAddress?.trim() || ""
  const displayName =
    ctx.displayName?.trim() ||
    ctx.title?.trim() ||
    buildSlotTitle(profile) ||
    "Ячейка склада"

  return {
    locationCode: code,
    displayName,
    title: ctx.title?.trim() || displayName,
    subtitle: ctx.subtitle?.trim() || "",
    slotTitle: buildSlotTitle(profile),
    materialType: profile?.materialType?.trim() || "",
    materialTypeLabel: slotLabel("materialType", profile?.materialType),
    processType: profile?.processType?.trim() || "",
    processTypeLabel: slotLabel("processType", profile?.processType),
    stickerShapeLabel: slotLabel("stickerShape", profile?.stickerShape),
    productGroupLabel: slotLabel("productGroup", profile?.productGroup),
    volumeLabel: slotLabel("volume", profile?.volume),
    physicalAddress,
    addressClass: parseAddressClass(physicalAddress),
    warehouseCode: ctx.warehouseCode?.trim() || "",
    warehouseName: ctx.warehouseCode ? warehouseDisplayLabel(ctx.warehouseCode) : "",
    zoneCode: ctx.zoneCode?.trim() || "",
    zoneName: ctx.zoneCode ? zoneDisplayLabel(ctx.zoneCode) : "",
    codeTitle: explanation.title,
    codeSummary: explanation.summary,
    codeHint: explanation.hint || "",
  }
}

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export function renderCellLabelText(template: string, values: Record<string, string>): string {
  return template.replace(VAR_RE, (_, key: string) => values[key] ?? "").trim()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function blockCss(block: CellLabelTextBlock): string {
  const weight =
    block.fontWeight === "bold" ? "font-weight:600;" : block.fontWeight === "mono" ? "font-family:Consolas,monospace;" : ""
  const color = block.fontSizePt <= 7 ? "color:#555;" : ""
  return `font-size:${block.fontSizePt}pt;text-align:${block.align};margin:0 0 3px;${weight}${color}`
}

export function buildCellLabelPrintHtml(
  template: CellLabelTemplate,
  values: Record<string, string>,
  qrSvg: string
): string {
  const before = template.textBlocks.filter((b) => b.visible && b.placement === "before")
  const after = template.textBlocks.filter((b) => b.visible && b.placement === "after")

  const renderBlocks = (blocks: CellLabelTextBlock[]) =>
    blocks
      .map((b) => {
        const text = renderCellLabelText(b.template, values)
        if (!text) return ""
        return `<p style="${blockCss(b)}">${escapeHtml(text)}</p>`
      })
      .join("")

  const qrBlock =
    template.showQr && qrSvg.trim()
      ? `<div class="qr" style="margin:4px 0;">${qrSvg}</div>`
      : ""

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Ячейка ${escapeHtml(values.locationCode ?? "")}</title>
  <style>
    @page { size: ${template.widthMm}mm ${template.heightMm}mm; margin: ${template.marginMm}mm; }
    body { font-family: Arial, sans-serif; margin: 0; padding: ${template.marginMm}mm; text-align: center; box-sizing: border-box; }
    .qr svg { width: ${template.qrSizeMm}mm; height: ${template.qrSizeMm}mm; max-width: 100%; }
  </style>
</head>
<body>
  ${renderBlocks(before)}
  ${qrBlock}
  ${renderBlocks(after)}
  <script>window.onload = () => { setTimeout(() => window.print(), 120); };</script>
</body>
</html>`
}

/** Печать через Blob URL — document.write в окно с noopener в Chrome даёт about:blank. */
export function openLabelPrintWindow(html: string, widthPx = 480, heightPx = 640): boolean {
  if (typeof window === "undefined") return false
  const blob = new Blob([html], { type: "text/html;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, "_blank", `width=${widthPx},height=${heightPx}`)
  if (!w) {
    URL.revokeObjectURL(url)
    return false
  }
  w.addEventListener("load", () => URL.revokeObjectURL(url), { once: true })
  return true
}

function normalizeTemplate(raw: unknown): CellLabelTemplate {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CELL_LABEL_TEMPLATE, textBlocks: [...DEFAULT_CELL_LABEL_TEMPLATE.textBlocks] }
  const o = raw as Partial<CellLabelTemplate>
  const blocks = Array.isArray(o.textBlocks)
    ? o.textBlocks
        .filter((b): b is CellLabelTextBlock => Boolean(b && typeof b === "object" && typeof (b as CellLabelTextBlock).template === "string"))
        .map((b) => ({
          id: typeof b.id === "string" ? b.id : newBlock(b.template).id,
          template: b.template,
          fontSizePt: Number.isFinite(b.fontSizePt) ? b.fontSizePt : 9,
          fontWeight: b.fontWeight === "bold" || b.fontWeight === "mono" ? b.fontWeight : "normal",
          align: b.align === "left" || b.align === "right" ? b.align : "center",
          placement: b.placement === "after" ? "after" : "before",
          visible: b.visible !== false,
        }))
    : DEFAULT_CELL_LABEL_TEMPLATE.textBlocks.map((b) => ({ ...b }))

  return {
    widthMm: clampLabelMm(Number(o.widthMm), CELL_LABEL_SIZE_MIN.widthMm, CELL_LABEL_SIZE_MAX.widthMm, DEFAULT_CELL_LABEL_TEMPLATE.widthMm),
    heightMm: clampLabelMm(Number(o.heightMm), CELL_LABEL_SIZE_MIN.heightMm, CELL_LABEL_SIZE_MAX.heightMm, DEFAULT_CELL_LABEL_TEMPLATE.heightMm),
    marginMm: clampLabelMm(Number(o.marginMm), CELL_LABEL_SIZE_MIN.marginMm, CELL_LABEL_SIZE_MAX.marginMm, DEFAULT_CELL_LABEL_TEMPLATE.marginMm),
    qrSizeMm: clampLabelMm(Number(o.qrSizeMm), CELL_LABEL_SIZE_MIN.qrSizeMm, CELL_LABEL_SIZE_MAX.qrSizeMm, DEFAULT_CELL_LABEL_TEMPLATE.qrSizeMm),
    showQr: o.showQr !== false,
    textBlocks: blocks.length ? blocks : DEFAULT_CELL_LABEL_TEMPLATE.textBlocks.map((b) => ({ ...b })),
  }
}

export function readCellLabelTemplate(): CellLabelTemplate {
  if (typeof window === "undefined") return DEFAULT_CELL_LABEL_TEMPLATE
  try {
    const raw = localStorage.getItem(CELL_LABEL_TEMPLATE_STORAGE_KEY)
    if (!raw) return DEFAULT_CELL_LABEL_TEMPLATE
    return normalizeTemplate(JSON.parse(raw))
  } catch {
    return DEFAULT_CELL_LABEL_TEMPLATE
  }
}

export function writeCellLabelTemplate(template: CellLabelTemplate): void {
  if (typeof window === "undefined") return
  localStorage.setItem(CELL_LABEL_TEMPLATE_STORAGE_KEY, JSON.stringify(template))
  window.dispatchEvent(new CustomEvent(CELL_LABEL_TEMPLATE_EVENT))
}

export function cloneCellLabelTemplate(template: CellLabelTemplate): CellLabelTemplate {
  return {
    ...template,
    textBlocks: template.textBlocks.map((b) => ({ ...b })),
  }
}
