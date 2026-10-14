import { unzipSync } from "fflate"
import type { ParsedLine } from "./upd.ts"
import { childrenNamed, parseXml, textOf, findAll, type XmlNode } from "./xml.ts"

/** CSV / XLSX → строки табличной части. Заголовки шапки (номер, дата, контрагент) пользователь подтверждает в предпросмотре. */

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3))
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder("windows-1251").decode(bytes)
  }
}

export function parseCsv(text: string, maxRows = 10000): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? ""
  const counts = [";", ",", "\t"].map((d) => [d, first.split(d).length] as const)
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
      continue
    }
    if (ch === '"' && cell === "") quoted = true
    else if (ch === delim) {
      row.push(cell)
      cell = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(cell)
      cell = ""
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      if (rows.length >= maxRows) break
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    if (row.some((c) => c.trim())) rows.push(row)
  }
  return rows
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A"
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Первый лист XLSX без сторонних библиотек: sharedStrings + sheet1, ограничения на размер распаковки. */
export function parseXlsx(bytes: Uint8Array, maxRows = 10000): string[][] {
  let total = 0
  const files = unzipSync(bytes, {
    filter: (f) => {
      const want = f.name === "xl/sharedStrings.xml" || f.name === "xl/workbook.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name)
      if (!want) return false
      total += f.originalSize
      if (f.originalSize > 50 * 1024 * 1024 || total > 120 * 1024 * 1024) throw new Error("XLSX слишком большой после распаковки")
      return true
    },
  })
  const dec = (name: string) => (files[name] ? new TextDecoder().decode(files[name]) : "")
  const shared: string[] = []
  const ss = dec("xl/sharedStrings.xml")
  if (ss) {
    for (const si of childrenNamed(parseXml(ss), "si")) {
      shared.push(findAll(si, "t").map(textOf).join("") || textOf(si))
    }
  }
  const sheetName = Object.keys(files).filter((n) => n.startsWith("xl/worksheets/")).sort()[0]
  if (!sheetName) return []
  const sheet = parseXml(dec(sheetName))
  const data = sheet.children.find((c) => c.name === "sheetData")
  const rows: string[][] = []
  for (const r of childrenNamed(data, "row")) {
    const out: string[] = []
    for (const c of childrenNamed(r, "c")) {
      const idx = colIndex(c.attrs.r || "")
      const v = textOf(c.children.find((x) => x.name === "v"))
      let value = v
      if (c.attrs.t === "s") value = shared[Number(v)] ?? ""
      else if (c.attrs.t === "inlineStr") value = findAll(c as XmlNode, "t").map(textOf).join("")
      out[idx] = value
    }
    for (let i = 0; i < out.length; i++) if (out[i] == null) out[i] = ""
    if (out.some((x) => x.trim())) rows.push(out)
    if (rows.length >= maxRows) break
  }
  return rows
}

const HEADER_MAP: Array<[keyof ParsedLine | "skip", RegExp]> = [
  ["lineNo", /^(№|n|no|номер стр|№ п\/п|п\/п)$/i],
  ["name", /(наимен|товар|номенклат|описан|name|description)/i],
  ["supplierCode", /(артикул|код товара|код поставщ|sku|article|код$)/i],
  ["gtin", /(gtin|штрих|ean|баркод|barcode)/i],
  ["uomName", /(ед\.?\s*изм|единиц|uom|unit)/i],
  ["okei", /(океи|okei)/i],
  ["qty", /(кол|qty|quantity|количество)/i],
  ["price", /(цена|price)/i],
  ["vatRate", /(ставка|ндс\s*%|vat\s*rate)/i],
  ["vatAmount", /(сумма ндс|ндс, руб|vat amount|^ндс$)/i],
  ["amountTotal", /(сумма с ндс|всего|итого|total|сумма)/i],
  ["amountNet", /(без ндс|net)/i],
]

export function mapHeader(header: string[]): Array<keyof ParsedLine | null> {
  const used = new Set<string>()
  return header.map((h) => {
    const t = h.trim().toLowerCase()
    if (!t) return null
    for (const [key, re] of HEADER_MAP) {
      if (key === "skip" || used.has(key)) continue
      if (re.test(t)) {
        // «Сумма без НДС» должна попасть в amountNet, а не в amountTotal
        if (key === "amountTotal" && /без/.test(t)) continue
        used.add(key)
        return key
      }
    }
    return null
  })
}

function numCell(v: string | undefined): number | null {
  if (v == null || !v.trim()) return null
  const x = Number(v.replace(/\s| /g, "").replace(",", "."))
  return Number.isFinite(x) ? x : null
}

export function rowsToLines(rows: string[][]): { lines: ParsedLine[]; mapping: Array<keyof ParsedLine | null>; headerRow: string[] } {
  if (rows.length === 0) return { lines: [], mapping: [], headerRow: [] }
  let headerIdx = rows.findIndex((r) => mapHeader(r).filter(Boolean).length >= 2)
  if (headerIdx < 0) headerIdx = 0
  const headerRow = rows[headerIdx]
  const mapping = mapHeader(headerRow)
  const lines: ParsedLine[] = []
  for (const r of rows.slice(headerIdx + 1)) {
    const get = (k: keyof ParsedLine) => {
      const i = mapping.indexOf(k)
      return i >= 0 ? (r[i] ?? "").trim() : ""
    }
    const name = get("name")
    if (!name || /^(итого|всего)/i.test(name)) continue
    const gtin = get("gtin").replace(/\D/g, "")
    lines.push({
      lineNo: lines.length + 1,
      name,
      supplierCode: get("supplierCode") || null,
      gtin: /^\d{8,14}$/.test(gtin) ? gtin.padStart(14, "0") : null,
      okei: get("okei") || null,
      uomName: get("uomName") || null,
      qty: numCell(get("qty")) ?? 0,
      price: numCell(get("price")),
      amountNet: numCell(get("amountNet")),
      vatRate: get("vatRate") || null,
      vatAmount: numCell(get("vatAmount")),
      amountTotal: numCell(get("amountTotal")),
      markingCodes: [],
      packageCodes: [],
      country: null,
      customsDeclaration: null,
    })
  }
  return { lines, mapping, headerRow }
}

/** Реквизиты из неструктурированного текста (DOCX/TXT): только подсказки для ручной проверки. */
export function guessRequisites(text: string) {
  const inns = [...new Set([...text.matchAll(/ИНН[:\s]*(\d{10}|\d{12})\b/gi)].map((m) => m[1]))]
  const num = /(?:№|N)\s*([A-Za-zА-Яа-я0-9\-/]{1,30})\s*от\s*(\d{2}\.\d{2}\.\d{4})/.exec(text)
  const total = /(?:итого|всего)[^\d]{0,40}([\d\s]+[.,]\d{2})/i.exec(text)
  return {
    inns,
    number: num?.[1] ?? null,
    date: num ? num[2].split(".").reverse().join("-") : null,
    amountTotal: total ? Number(total[1].replace(/\s/g, "").replace(",", ".")) : null,
  }
}
