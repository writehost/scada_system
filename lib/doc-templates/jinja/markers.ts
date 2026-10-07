/**
 * Разметка «дизайн-HTML»: так Jinja-конструкции живут внутри редактора.
 * Импортёр превращает Jinja в эти атрибуты, экспортёр — обратно.
 */

/** `<span data-jinja-var="document.number">` → `{{ document.number }}` */
export const ATTR_VAR = "data-jinja-var"
/** Элемент выводится, только если условие истинно. */
export const ATTR_IF = "data-jinja-if"
/** Элемент повторяется: значение — заголовок цикла `item in document.items`. */
export const ATTR_FOR = "data-jinja-for"
/** Обёртка, которой нет в итоговом HTML: `if` (с ветками) или `for`. */
export const ATTR_WRAP = "data-jinja-wrap"
/** Ветка внутри обёртки `if`: `if`, `elif`, `else` (и `else` у `for`). */
export const ATTR_BRANCH = "data-jinja-branch"
/** Условие ветки `if`/`elif`. */
export const ATTR_COND = "data-jinja-cond"
/** Исходник, который нельзя разобрать безопасно, — переносится байт-в-байт. */
export const ATTR_RAW = "data-jinja-raw"
/** Атрибут с Jinja внутри значения: `data-jinja-attr-src="{{ product.image }}"`. */
export const ATTR_PREFIX_ATTR = "data-jinja-attr-"

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITY_MAP[body.toLowerCase()] ?? whole
  })
}

export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function hasJinja(value: string | null | undefined): boolean {
  return !!value && /\{\{|\{%|\{#/.test(value)
}

/** Значения атрибутов в разметке GrapesJS экранированы — внутри Jinja их надо вернуть как было. */
export function decodeJinjaSegments(text: string): string {
  return text.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, (seg) => decodeEntities(seg))
}
