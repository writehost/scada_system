/**
 * Безопасный разбор XML для документов ФНС и торговых сообщений.
 * - DOCTYPE и ENTITY запрещены полностью (нет XXE и «billion laughs»);
 * - лимиты: размер, глубина, число узлов, длина атрибута;
 * - кодировка из декларации (windows-1251 — стандарт для файлов ФНС) или UTF-8 / BOM.
 * Внешних зависимостей и сетевых обращений нет.
 */

export type XmlNode = {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

export class XmlError extends Error {}

const LIMITS = { bytes: 30 * 1024 * 1024, depth: 64, nodes: 500_000, attr: 1_000_000 }

export function decodeXmlBytes(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes.length > LIMITS.bytes) throw new XmlError("XML больше 30 МБ")
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" }
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return { text: new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be").decode(bytes.subarray(2)), encoding: "utf-16" }
  }
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200))
  const m = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i.exec(head)
  const enc = (m?.[1] || "utf-8").toLowerCase()
  const label = enc === "cp1251" || enc === "windows-1251" || enc === "win-1251" ? "windows-1251" : enc
  try {
    return { text: new TextDecoder(label, { fatal: label === "utf-8" }).decode(bytes), encoding: label }
  } catch {
    if (label === "utf-8") return { text: new TextDecoder("windows-1251").decode(bytes), encoding: "windows-1251" }
    throw new XmlError(`Неподдерживаемая кодировка XML: ${enc}`)
  }
}

function decodeEntities(s: string): string {
  if (!s.includes("&")) return s
  return s.replace(/&([^;\s&<]{0,12});?/g, (_m, e: string) => {
    if (!_m.endsWith(";")) throw new XmlError("Символ & без ссылки на сущность")
    if (e === "lt") return "<"
    if (e === "gt") return ">"
    if (e === "amp") return "&"
    if (e === "quot") return '"'
    if (e === "apos") return "'"
    if (!/^#(x[0-9a-fA-F]+|\d+)$/.test(e)) throw new XmlError(`Неизвестная сущность &${e}; (внешние и пользовательские сущности запрещены)`)
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    if (!Number.isFinite(code) || code > 0x10ffff) throw new XmlError("Некорректная ссылка на символ")
    return String.fromCodePoint(code)
  })
}

const NAME = /^[A-Za-zА-Яа-яЁё_:][\wА-Яа-яЁё.:-]*/

export function parseXml(input: string): XmlNode {
  let i = 0
  let nodes = 0
  const src = input
  const stack: XmlNode[] = []
  let root: XmlNode | null = null

  const fail = (msg: string): never => {
    throw new XmlError(`${msg} (позиция ${i})`)
  }

  while (i < src.length) {
    const lt = src.indexOf("<", i)
    if (lt === -1) {
      if (src.slice(i).trim() && stack.length) fail("Незакрытый элемент")
      break
    }
    if (lt > i && stack.length) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt))
    i = lt
    if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i)
      if (end === -1) fail("Незакрытая инструкция")
      i = end + 2
      continue
    }
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i)
      if (end === -1) fail("Незакрытый комментарий")
      i = end + 3
      continue
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i)
      if (end === -1) fail("Незакрытый CDATA")
      if (stack.length) stack[stack.length - 1].text += src.slice(i + 9, end)
      i = end + 3
      continue
    }
    if (src.startsWith("<!", i)) fail("DOCTYPE и сущности в XML запрещены")
    if (src.startsWith("</", i)) {
      const end = src.indexOf(">", i)
      if (end === -1) fail("Незакрытый тег")
      const name = src.slice(i + 2, end).trim()
      const open = stack.pop()
      if (!open || open.name !== name) fail(`Неожиданный закрывающий тег </${name}>`)
      i = end + 1
      continue
    }
    // открывающий тег
    i += 1
    const nm = NAME.exec(src.slice(i, i + 200))
    if (!nm) fail("Некорректное имя элемента")
    const node: XmlNode = { name: nm![0], attrs: {}, children: [], text: "" }
    i += nm![0].length
    if (++nodes > LIMITS.nodes) fail("Слишком много элементов")
    let selfClose = false
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++
      if (src[i] === "/" && src[i + 1] === ">") {
        selfClose = true
        i += 2
        break
      }
      if (src[i] === ">") {
        i += 1
        break
      }
      const an = NAME.exec(src.slice(i, i + 200))
      if (!an) fail("Некорректный атрибут")
      i += an![0].length
      while (/\s/.test(src[i])) i++
      if (src[i] !== "=") fail("Ожидался знак = в атрибуте")
      i++
      while (/\s/.test(src[i])) i++
      const q = src[i]
      if (q !== '"' && q !== "'") fail("Значение атрибута без кавычек")
      const end = src.indexOf(q, i + 1)
      if (end === -1 || end - i > LIMITS.attr) fail("Незакрытое значение атрибута")
      const raw = src.slice(i + 1, end)
      if (raw.includes("<")) fail("Символ < в значении атрибута")
      node.attrs[an![0]] = decodeEntities(raw)
      i = end + 1
    }
    if (stack.length) stack[stack.length - 1].children.push(node)
    else if (root) fail("Несколько корневых элементов")
    else root = node
    if (!selfClose) {
      stack.push(node)
      if (stack.length > LIMITS.depth) fail("Слишком глубокая вложенность")
    }
  }
  if (stack.length) throw new XmlError(`Незакрытый элемент <${stack[stack.length - 1].name}>`)
  if (!root) throw new XmlError("Пустой XML")
  return root
}

/* ---------- навигация ---------- */

export function child(node: XmlNode | null | undefined, name: string): XmlNode | null {
  return node?.children.find((c) => c.name === name) ?? null
}

export function childrenNamed(node: XmlNode | null | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => c.name === name) ?? []
}

export function path(node: XmlNode | null | undefined, ...names: string[]): XmlNode | null {
  let cur: XmlNode | null | undefined = node
  for (const n of names) cur = child(cur, n)
  return cur ?? null
}

export function find(node: XmlNode | null | undefined, name: string): XmlNode | null {
  if (!node) return null
  for (const c of node.children) {
    if (c.name === name) return c
    const deep = find(c, name)
    if (deep) return deep
  }
  return null
}

export function findAll(node: XmlNode | null | undefined, name: string, out: XmlNode[] = []): XmlNode[] {
  if (!node) return out
  for (const c of node.children) {
    if (c.name === name) out.push(c)
    findAll(c, name, out)
  }
  return out
}

export function textOf(node: XmlNode | null | undefined): string {
  return (node?.text ?? "").trim()
}

/** Весь текст и значения атрибутов — для полнотекстового поиска. */
export function flatText(node: XmlNode, out: string[] = [], limit = 200_000): string {
  for (const v of Object.values(node.attrs)) out.push(v)
  if (node.text.trim()) out.push(node.text.trim())
  for (const c of node.children) {
    if (out.length > limit) break
    flatText(c, out, limit)
  }
  return out.join(" ").slice(0, limit)
}
