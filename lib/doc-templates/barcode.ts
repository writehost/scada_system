import bwipjs from "bwip-js"
import { escapeAttr } from "./jinja/markers.ts"

/**
 * Штрихкоды документов — через bwip-js, как в остальном проекте.
 * Один и тот же код рисует превью на холсте и итоговое изображение в шаблоне,
 * поэтому превью совпадает с PDF.
 */

export type BarcodeKind = "qrcode" | "code128" | "gs1-128" | "datamatrix" | "gs1datamatrix" | "ean13"

export const BARCODE_KINDS: { id: BarcodeKind; label: string; twoD: boolean }[] = [
  { id: "qrcode", label: "QR-код", twoD: true },
  { id: "datamatrix", label: "DataMatrix", twoD: true },
  { id: "gs1datamatrix", label: "GS1 DataMatrix (Честный знак)", twoD: true },
  { id: "code128", label: "Code 128", twoD: false },
  { id: "gs1-128", label: "GS1-128", twoD: false },
  { id: "ean13", label: "EAN-13", twoD: false },
]

export type BarcodeOptions = {
  kind: BarcodeKind
  /** Уровень коррекции ошибок QR. */
  ecc?: "L" | "M" | "Q" | "H"
  /** Подпись под линейным кодом. */
  humanReadable?: boolean
  rotate?: 0 | 90 | 180 | 270
}

const ROTATE: Record<number, "N" | "R" | "I" | "L"> = { 0: "N", 90: "R", 180: "I", 270: "L" }

function fnc1Text(value: string): string {
  // Разделитель GS (0x1D) в коде маркировки кодируется как FNC1.
  return `^FNC1${value.replace(/\^/g, "^094").replace(/\u001d/g, "^FNC1")}`
}

function bwipOptions(value: string, opts: BarcodeOptions): Record<string, unknown> {
  const base: Record<string, unknown> = { scale: 3, paddingwidth: 0, paddingheight: 0, rotate: ROTATE[opts.rotate ?? 0] ?? "N" }
  switch (opts.kind) {
    case "qrcode":
      return { ...base, bcid: "qrcode", text: value, eclevel: opts.ecc ?? "M" }
    case "datamatrix":
      return { ...base, bcid: "datamatrix", text: value }
    case "gs1datamatrix":
      return value.trim().startsWith("(")
        ? { ...base, bcid: "gs1datamatrix", text: value.trim() }
        : { ...base, bcid: "datamatrix", text: fnc1Text(value), parsefnc: true }
    case "gs1-128":
      return value.trim().startsWith("(")
        ? { ...base, bcid: "gs1-128", text: value.trim(), height: 12, includetext: !!opts.humanReadable, textsize: 9 }
        : { ...base, bcid: "code128", text: fnc1Text(value), parsefnc: true, height: 12, includetext: !!opts.humanReadable, alttext: value.replace(/\u001d/g, ""), textsize: 9 }
    case "ean13":
      return { ...base, bcid: "ean13", text: value.replace(/\D/g, "").slice(-13).padStart(13, "0"), height: 14, includetext: !!opts.humanReadable, textsize: 9 }
    default:
      return { ...base, bcid: "code128", text: value, height: 12, includetext: !!opts.humanReadable, textsize: 9 }
  }
}

/** SVG штрихкода или null, если данные не подходят для выбранной символики. */
export function barcodeSvg(value: string, opts: BarcodeOptions): string | null {
  const text = String(value ?? "")
  if (!text.trim()) return null
  try {
    return bwipjs.toSVG(bwipOptions(text, opts) as Parameters<typeof bwipjs.toSVG>[0])
  } catch {
    return null
  }
}

function toBase64(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf8").toString("base64")
  return btoa(unescape(encodeURIComponent(s)))
}

export function barcodeDataUri(value: string, opts: BarcodeOptions): string {
  const svg = barcodeSvg(value, opts)
  if (!svg) return ""
  return `data:image/svg+xml;base64,${toBase64(svg)}`
}

export function normalizeBarcodeOptions(input: unknown): BarcodeOptions {
  const src = (input && typeof input === "object" ? input : {}) as Partial<BarcodeOptions>
  const kind = BARCODE_KINDS.some((k) => k.id === src.kind) ? (src.kind as BarcodeKind) : "qrcode"
  const ecc = src.ecc && ["L", "M", "Q", "H"].includes(src.ecc) ? src.ecc : "M"
  const rotate = [0, 90, 180, 270].includes(Number(src.rotate)) ? (Number(src.rotate) as BarcodeOptions["rotate"]) : 0
  return { kind, ecc, humanReadable: !!src.humanReadable, rotate }
}

/** Конфиг блока штрихкода в шаблоне: источник данных — Jinja-выражение. */
export type BarcodeBlockConfig = BarcodeOptions & { expr: string; sizeMm: number }

export function normalizeBarcodeBlock(input: unknown): BarcodeBlockConfig {
  const src = (input && typeof input === "object" ? input : {}) as Partial<BarcodeBlockConfig>
  const size = Number(src.sizeMm)
  return {
    ...normalizeBarcodeOptions(src),
    expr: typeof src.expr === "string" ? src.expr : "document.url",
    sizeMm: Number.isFinite(size) && size >= 5 && size <= 200 ? size : 25,
  }
}

export function isLinearBarcode(kind: BarcodeKind): boolean {
  return !BARCODE_KINDS.find((k) => k.id === kind)?.twoD
}

/** Выражение для атрибута src: barcode(значение, вид, коррекция, подпись, поворот). */
export function barcodeJinjaExpr(cfg: BarcodeBlockConfig): string {
  const expr = cfg.expr.trim() || "''"
  return `barcode(${expr}, '${cfg.kind}', '${cfg.ecc ?? "M"}', ${cfg.humanReadable ? "true" : "false"}, ${cfg.rotate ?? 0})`
}

export function barcodeSizeStyle(cfg: BarcodeBlockConfig): string {
  if (isLinearBarcode(cfg.kind)) {
    const w = cfg.sizeMm * 2
    return cfg.rotate === 90 || cfg.rotate === 270 ? `width:${cfg.sizeMm * 0.6}mm;height:${w}mm` : `width:${w}mm;height:${cfg.sizeMm * 0.6}mm`
  }
  return `width:${cfg.sizeMm}mm;height:${cfg.sizeMm}mm`
}

/** Разметка блока для экспорта: src вычисляется backend-ом через barcode(). */
export function barcodeDesignHtml(cfg: BarcodeBlockConfig, extraAttrs = ""): string {
  const cls = isLinearBarcode(cfg.kind) ? "doc-barcode doc-barcode-linear" : "doc-barcode"
  return `<img class="${cls}" style="${barcodeSizeStyle(cfg)}" alt="" data-doc-barcode="${escapeAttr(JSON.stringify(cfg))}" data-jinja-attr-src="${escapeAttr(`{{ ${barcodeJinjaExpr(cfg)} }}`)}"${extraAttrs}>`
}
