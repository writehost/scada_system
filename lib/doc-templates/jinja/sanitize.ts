import { decodeEntities, escapeAttr } from "./markers.ts"
import { tokenize, type HtmlAttr, type TagToken } from "./tokenize.ts"

/**
 * Шаблон документа не должен исполнять JS ни в редакторе, ни в предпросмотре, ни в PDF.
 * Санитайзер работает на уровне токенов и не трогает Jinja.
 */

const FORBIDDEN_TAGS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "base",
  "link",
  "noscript",
  "portal",
  "form",
])

const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "background", "poster", "data", "srcset"])

const SAFE_DATA_URL = /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml)[;,]/

function normalizedUrl(value: string): string {
  return decodeEntities(value)
    .replace(/[\u0000- \u007f-\u009f]/g, "")
    .toLowerCase()
}

export function isDangerousUrl(value: string): boolean {
  const v = normalizedUrl(value)
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return true
  if (v.startsWith("data:") && !SAFE_DATA_URL.test(v)) return true
  return false
}

export function isDangerousStyle(value: string): boolean {
  const v = normalizedUrl(value)
  return v.includes("expression(") || v.includes("javascript:") || v.includes("behavior:") || v.includes("-moz-binding")
}

export function isForbiddenTag(name: string): boolean {
  return FORBIDDEN_TAGS.has(name.toLowerCase())
}

export function isAllowedAttr(attr: HtmlAttr): boolean {
  const name = attr.name.toLowerCase()
  if (name.startsWith("on")) return false
  if (name === "srcdoc" || name === "formaction" || name === "http-equiv") return false
  if (attr.value == null) return true
  if (URL_ATTRS.has(name) && isDangerousUrl(attr.value)) return false
  if (name === "style" && isDangerousStyle(attr.value)) return false
  return true
}

export function cleanAttrs(attrs: HtmlAttr[]): { attrs: HtmlAttr[]; removed: string[] } {
  const kept: HtmlAttr[] = []
  const removed: string[] = []
  for (const a of attrs) {
    if (isAllowedAttr(a)) kept.push(a)
    else removed.push(a.name)
  }
  return { attrs: kept, removed }
}

export function cleanCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "invalid(")
    .replace(/javascript:/gi, "")
    .replace(/-moz-binding/gi, "")
    .replace(/behavior\s*:/gi, "")
}

/** Атрибуты переносятся как в исходнике: значение уже в HTML-кодировке. */
export function serializeAttrsRaw(attrs: HtmlAttr[]): string {
  return attrs
    .map((a) => {
      if (a.value == null) return ` ${a.name}`
      const quote = a.value.includes('"') && !a.value.includes("'") ? "'" : '"'
      const value = quote === '"' ? a.value.replace(/"/g, "&quot;") : a.value
      return ` ${a.name}=${quote}${value}${quote}`
    })
    .join("")
}

export function serializeOpenTag(tag: TagToken, attrs: HtmlAttr[]): string {
  return `<${tag.name}${serializeAttrsRaw(attrs)}${tag.selfClosing ? " /" : ""}>`
}

export function attrsFromPlain(map: Record<string, string>): HtmlAttr[] {
  return Object.entries(map).map(([name, value]) => ({ name, value: escapeAttr(value) }))
}

export type SanitizeReport = { html: string; removed: string[] }

/**
 * Полная очистка шаблона: опасные теги удаляются вместе с содержимым,
 * обработчики событий и javascript:-ссылки — вычищаются.
 */
export function sanitizeTemplateHtml(src: string): SanitizeReport {
  const tokens = tokenize(src)
  const out: string[] = []
  const removed: string[] = []
  let skipUntilClose: string | null = null
  for (const t of tokens) {
    if (skipUntilClose) {
      if (t.kind === "close" && t.name === skipUntilClose) skipUntilClose = null
      continue
    }
    if (t.kind === "open" || t.kind === "close") {
      if (isForbiddenTag(t.name)) {
        removed.push(`<${t.name}>`)
        if (t.kind === "open" && !t.selfClosing && (t.name === "script" || t.name === "noscript" || t.name === "iframe" || t.name === "object")) {
          skipUntilClose = t.name
        }
        continue
      }
      if (t.kind === "close") {
        out.push(src.slice(t.start, t.end))
        continue
      }
      if (t.jinjaOutsideValues) {
        const raw = src.slice(t.start, t.end)
        if (/\son[a-z]+\s*=|javascript:|vbscript:|srcdoc/i.test(raw)) {
          removed.push(`<${t.name}> (Jinja внутри тега)`)
          continue
        }
        out.push(raw)
        continue
      }
      const cleaned = cleanAttrs(t.attrs)
      if (cleaned.removed.length) {
        removed.push(...cleaned.removed.map((n) => `${t.name}[${n}]`))
        out.push(serializeOpenTag(t, cleaned.attrs))
      } else {
        out.push(src.slice(t.start, t.end))
      }
      continue
    }
    if (t.kind === "jrawblock") {
      const prev = out.length ? out[out.length - 1] : ""
      const chunk = src.slice(t.start, t.end)
      out.push(/^<style/i.test(prev) ? cleanCss(chunk) : chunk)
      continue
    }
    out.push(src.slice(t.start, t.end))
  }
  return { html: out.join(""), removed }
}
