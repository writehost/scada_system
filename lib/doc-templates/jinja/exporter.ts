import {
  ATTR_BRANCH,
  ATTR_COND,
  ATTR_FOR,
  ATTR_IF,
  ATTR_PREFIX_ATTR,
  ATTR_RAW,
  ATTR_VAR,
  ATTR_WRAP,
  decodeEntities,
  decodeJinjaSegments,
} from "./markers.ts"
import { cleanAttrs } from "./sanitize.ts"
import { VOID_TAGS, tokenize, type HtmlAttr, type TagToken, type Token } from "./tokenize.ts"

/**
 * «Дизайн-HTML» из редактора → Jinja HTML для backend-рендера.
 * Обратная операция к importer.ts.
 */

type El = { t: "el"; tag: TagToken; children: Node[]; closed: boolean }
type Node = El | { t: "text"; s: string } | { t: "raw"; s: string }

function buildTree(src: string, tokens: Token[]): Node[] {
  const root: Node[] = []
  const stack: { el: El | null; children: Node[] }[] = [{ el: null, children: root }]
  const top = () => stack[stack.length - 1]
  for (const t of tokens) {
    if (t.kind === "open") {
      const el: El = { t: "el", tag: t, children: [], closed: false }
      top().children.push(el)
      if (!t.selfClosing && !VOID_TAGS.has(t.name)) stack.push({ el, children: el.children })
      continue
    }
    if (t.kind === "close") {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].el?.tag.name === t.name) {
          stack[k].el!.closed = true
          stack.length = k
          break
        }
      }
      continue
    }
    if (t.kind === "doctype") continue
    if (t.kind === "jrawblock" || t.kind === "comment") {
      top().children.push({ t: "raw", s: src.slice(t.start, t.end) })
      continue
    }
    top().children.push({ t: "text", s: src.slice(t.start, t.end) })
  }
  return root
}

function attrValue(attrs: HtmlAttr[], name: string): string | null {
  const a = attrs.find((x) => x.name === name)
  if (!a) return null
  return decodeEntities(a.value ?? "")
}

/** Значение атрибута с Jinja выводится без HTML-кодирования: это исходник шаблона. */
function quoteJinjaAttr(value: string): string {
  if (!value.includes('"')) return `"${value}"`
  if (!value.includes("'")) return `'${value}'`
  return `"${value.replace(/"/g, "&quot;")}"`
}

function quoteAttr(value: string): string {
  return `"${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`
}

class Exporter {
  emitAll(nodes: Node[]): string {
    return nodes.map((n) => this.emit(n)).join("")
  }

  emit(n: Node): string {
    if (n.t === "text") return decodeJinjaSegments(n.s)
    if (n.t === "raw") return n.s
    return this.emitElement(n)
  }

  emitElement(n: El): string {
    const attrs = n.tag.attrs
    const raw = attrValue(attrs, ATTR_RAW)
    if (raw != null) return raw
    const expr = attrValue(attrs, ATTR_VAR)
    if (expr != null) return expr.trim() ? `{{ ${expr.trim()} }}` : ""
    const wrap = attrValue(attrs, ATTR_WRAP)
    if (wrap === "if") return this.emitIfWrapper(n)
    if (wrap === "for") return this.emitForWrapper(n)
    // Ветка вне обёртки (обёртку удалили в редакторе) — выводим содержимое как есть.
    if (attrValue(attrs, ATTR_BRANCH) != null) return this.emitAll(n.children)

    let html = this.emitPlainElement(n)
    const cond = attrValue(attrs, ATTR_IF)
    if (cond != null && cond.trim()) html = `{% if ${cond.trim()} %}${html}{% endif %}`
    const loop = attrValue(attrs, ATTR_FOR)
    if (loop != null && loop.trim()) html = `{% for ${loop.trim()} %}${html}{% endfor %}`
    return html
  }

  emitPlainElement(n: El): string {
    const { attrs } = cleanAttrs(n.tag.attrs)
    const plain = new Map<string, string | null>()
    const jinja = new Map<string, string>()
    for (const a of attrs) {
      if (a.name.startsWith(ATTR_PREFIX_ATTR)) {
        jinja.set(a.name.slice(ATTR_PREFIX_ATTR.length), decodeEntities(a.value ?? ""))
        continue
      }
      if (a.name.startsWith("data-jinja-") || a.name.startsWith("data-gjs-")) continue
      plain.set(a.name, a.value == null ? null : decodeEntities(a.value))
    }
    const parts: string[] = []
    for (const [name, value] of plain) {
      if (jinja.has(name) && (name === "class" || name === "style")) {
        const sep = name === "class" ? " " : "; "
        parts.push(` ${name}=${quoteJinjaAttr(`${value ?? ""}${value ? sep : ""}${jinja.get(name)}`)}`)
        jinja.delete(name)
        continue
      }
      if (jinja.has(name)) continue
      parts.push(value == null ? ` ${name}` : ` ${name}=${quoteAttr(value)}`)
    }
    for (const [name, value] of jinja) parts.push(` ${name}=${quoteJinjaAttr(value)}`)
    const open = `<${n.tag.name}${parts.join("")}>`
    if (VOID_TAGS.has(n.tag.name)) return open
    return `${open}${this.emitAll(n.children)}</${n.tag.name}>`
  }

  branches(n: El): El[] {
    return n.children.filter((c): c is El => c.t === "el" && attrValue(c.tag.attrs, ATTR_BRANCH) != null)
  }

  emitIfWrapper(n: El): string {
    const single = attrValue(n.tag.attrs, ATTR_IF)
    const branches = this.branches(n)
    if (single != null || !branches.length) {
      const cond = (single ?? "").trim() || "false"
      return `{% if ${cond} %}${this.emitAll(n.children)}{% endif %}`
    }
    let out = ""
    let first = true
    let hasElse = false
    for (const b of branches) {
      const kind = attrValue(b.tag.attrs, ATTR_BRANCH)
      const cond = (attrValue(b.tag.attrs, ATTR_COND) ?? "").trim() || "false"
      if (kind === "else") {
        if (hasElse || first) continue
        out += `{% else %}${this.emitAll(b.children)}`
        hasElse = true
        continue
      }
      if (hasElse) continue
      out += first ? `{% if ${cond} %}` : `{% elif ${cond} %}`
      out += this.emitAll(b.children)
      first = false
    }
    return first ? "" : `${out}{% endif %}`
  }

  emitForWrapper(n: El): string {
    const head = (attrValue(n.tag.attrs, ATTR_FOR) ?? "").trim()
    if (!head) return this.emitAll(n.children)
    const branches = this.branches(n)
    if (!branches.length) return `{% for ${head} %}${this.emitAll(n.children)}{% endfor %}`
    const body = branches.find((b) => attrValue(b.tag.attrs, ATTR_BRANCH) !== "else")
    const otherwise = branches.find((b) => attrValue(b.tag.attrs, ATTR_BRANCH) === "else")
    const elsePart = otherwise ? `{% else %}${this.emitAll(otherwise.children)}` : ""
    return `{% for ${head} %}${body ? this.emitAll(body.children) : ""}${elsePart}{% endfor %}`
  }
}

/** Только тело документа. */
export function designHtmlToJinja(designHtml: string): string {
  const tree = buildTree(designHtml, tokenize(designHtml))
  return new Exporter().emitAll(tree)
}
