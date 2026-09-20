import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import type { Torg1Line } from "@/lib/wms/torg1"

const LINE_TEMPLATE_RE =
  /\{\{?\s*(?:line\.(?:name|itemCode|uom|qtyDoc|qtyFact|lotCode|note|lineNo)|lines(?:\.names)?)\s*\}\}/

type SharedStrings = {
  values: string[]
  nodes: XmlElement[]
}

type CellSource = {
  text: string
  richNode: XmlElement | null
}

type CellReference = {
  col: string
  row: number
  absoluteCol: boolean
  absoluteRow: boolean
}

type XmlCollection<T> = {
  readonly length: number
  item(index: number): T | null
}

function elements<T extends XmlElement = XmlElement>(list: XmlCollection<T>): T[] {
  const result: T[] = []
  for (let index = 0; index < list.length; index += 1) {
    const item = list.item(index)
    if (item) result.push(item)
  }
  return result
}

function firstDirectChild(parent: XmlElement, localName: string): XmlElement | null {
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes.item(index)
    if (
      node?.nodeType === 1 &&
      ((node as XmlElement).localName === localName || node.nodeName === localName)
    ) {
      return node as XmlElement
    }
  }
  return null
}

function removeDirectChildren(parent: XmlElement, names: Set<string>) {
  const toRemove: XmlNode[] = []
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes.item(index)
    if (node?.nodeType !== 1) continue
    const element = node as XmlElement
    const name = element.localName || element.nodeName
    if (names.has(name)) toRemove.push(node)
  }
  for (const node of toRemove) parent.removeChild(node)
}

function parseXml(bytes: Uint8Array): XmlDocument {
  return new DOMParser().parseFromString(strFromU8(bytes), "application/xml")
}

function serializeXml(document: XmlDocument): Uint8Array {
  return strToU8(new XMLSerializer().serializeToString(document))
}

function readSharedStrings(files: Record<string, Uint8Array>): SharedStrings {
  const bytes = files["xl/sharedStrings.xml"]
  if (!bytes) return { values: [], nodes: [] }
  const document = parseXml(bytes)
  const nodes = elements(document.getElementsByTagName("si"))
  return {
    nodes,
    values: nodes.map((node) => node.textContent ?? ""),
  }
}

function readCellSource(cell: XmlElement, sharedStrings: SharedStrings): CellSource {
  const type = cell.getAttribute("t")
  if (type === "s") {
    const index = Number(firstDirectChild(cell, "v")?.textContent ?? "")
    return {
      text: Number.isInteger(index) ? sharedStrings.values[index] ?? "" : "",
      richNode: Number.isInteger(index) ? sharedStrings.nodes[index] ?? null : null,
    }
  }
  if (type === "inlineStr") {
    const inline = firstDirectChild(cell, "is")
    return {
      text: inline?.textContent ?? "",
      richNode: inline,
    }
  }
  const value = firstDirectChild(cell, "v")
  return { text: value?.textContent ?? "", richNode: null }
}

function setTextNodeValue(node: XmlElement, value: string) {
  node.textContent = value
  if (/^\s|\s$|\n/.test(value)) {
    node.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve"
    )
  } else {
    node.removeAttributeNS("http://www.w3.org/XML/1998/namespace", "space")
    node.removeAttribute("xml:space")
  }
}

function setCellText(
  document: XmlDocument,
  cell: XmlElement,
  value: string,
  richNode: XmlElement | null
) {
  removeDirectChildren(cell, new Set(["f", "v", "is"]))
  cell.setAttribute("t", "inlineStr")

  const namespace = document.documentElement.namespaceURI
  const inline = document.createElementNS(namespace, "is")
  if (richNode) {
    for (let index = 0; index < richNode.childNodes.length; index += 1) {
      const child = richNode.childNodes.item(index)
      if (child) inline.appendChild(document.importNode(child, true))
    }
  }

  const textNodes = elements(inline.getElementsByTagName("t"))
  if (textNodes.length === 0) {
    const textNode = document.createElementNS(namespace, "t")
    setTextNodeValue(textNode, value)
    inline.appendChild(textNode)
  } else {
    setTextNodeValue(textNodes[0], value)
    for (let index = 1; index < textNodes.length; index += 1) {
      setTextNodeValue(textNodes[index], "")
    }
  }
  cell.appendChild(inline)
}

function lineValue(line: Torg1Line, key: string, index: number): string {
  switch (key) {
    case "line.name":
    case "lines":
    case "lines.names":
      return String(line.name || line.itemCode || "").trim()
    case "line.itemCode":
      return String(line.itemCode || "").trim()
    case "line.uom":
      return String(line.uom || "").trim()
    case "line.qtyDoc":
      return String(line.qtyDoc ?? "").trim()
    case "line.qtyFact":
      return String(line.qtyFact ?? "").trim()
    case "line.lotCode":
      return String(line.lotCode || "").trim()
    case "line.note":
      return String(line.note || "").trim()
    case "line.lineNo":
      return String(index + 1)
    default:
      return ""
  }
}

function substituteLineVariables(
  text: string,
  line: Torg1Line,
  index: number
): string {
  return text.replace(
    /\{\{?\s*(line\.(?:name|itemCode|uom|qtyDoc|qtyFact|lotCode|note|lineNo)|lines(?:\.names)?)\s*\}\}/g,
    (_full, key: string) => lineValue(line, key, index)
  )
}

function substituteVariables(text: string, variables: Record<string, string>): string {
  if (!text.includes("{{")) return text
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_full, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key)
      ? variables[key] ?? ""
      : `{{${key}}}`
  )
}

function parseCellReference(value: string): CellReference | null {
  const match = value.match(/^(\$?)([A-Z]{1,3})(\$?)(\d+)$/i)
  if (!match) return null
  return {
    absoluteCol: match[1] === "$",
    col: match[2].toUpperCase(),
    absoluteRow: match[3] === "$",
    row: Number(match[4]),
  }
}

function formatCellReference(reference: CellReference): string {
  return `${reference.absoluteCol ? "$" : ""}${reference.col}${
    reference.absoluteRow ? "$" : ""
  }${reference.row}`
}

function shiftSingleReference(value: string, fromRow: number, count: number): string {
  const reference = parseCellReference(value)
  if (!reference || reference.row < fromRow) return value
  return formatCellReference({ ...reference, row: reference.row + count })
}

function shiftRangeReference(value: string, fromRow: number, count: number): string {
  return value
    .split(/\s+/)
    .map((segment) => {
      const parts = segment.split(":")
      if (parts.length === 1) return shiftSingleReference(parts[0], fromRow, count)
      if (parts.length !== 2) return segment
      const start = parseCellReference(parts[0])
      const end = parseCellReference(parts[1])
      if (!start || !end) return segment
      if (start.row >= fromRow) {
        start.row += count
        end.row += count
      } else if (end.row >= fromRow) {
        end.row += count
      }
      return `${formatCellReference(start)}:${formatCellReference(end)}`
    })
    .join(" ")
}

function referenceWithRow(value: string, row: number): string {
  const reference = parseCellReference(value)
  if (!reference) return value
  return formatCellReference({ ...reference, row })
}

function rowCells(row: XmlElement): XmlElement[] {
  return elements(row.getElementsByTagName("c"))
}

function rowHasLineTemplate(row: XmlElement, sharedStrings: SharedStrings): boolean {
  return rowCells(row).some((cell) =>
    LINE_TEMPLATE_RE.test(readCellSource(cell, sharedStrings).text)
  )
}

function mergeRows(reference: string): { start: number; end: number } | null {
  const [startRaw, endRaw = startRaw] = reference.split(":")
  const start = parseCellReference(startRaw)
  const end = parseCellReference(endRaw)
  return start && end ? { start: start.row, end: end.row } : null
}

function setRowNumber(row: XmlElement, rowNumber: number) {
  row.setAttribute("r", String(rowNumber))
  for (const cell of rowCells(row)) {
    const reference = cell.getAttribute("r")
    if (reference) cell.setAttribute("r", referenceWithRow(reference, rowNumber))
  }
}

function shiftWorksheetReferences(
  document: XmlDocument,
  templateRow: number,
  count: number
) {
  if (count <= 0) return
  const fromRow = templateRow + 1

  for (const row of elements(document.getElementsByTagName("row"))) {
    const rowNumber = Number(row.getAttribute("r"))
    if (Number.isInteger(rowNumber) && rowNumber >= fromRow) {
      setRowNumber(row, rowNumber + count)
    }
  }

  const dimension = elements(document.getElementsByTagName("dimension"))[0]
  const dimensionRef = dimension?.getAttribute("ref")
  if (dimension && dimensionRef) {
    dimension.setAttribute("ref", shiftRangeReference(dimensionRef, fromRow, count))
  }

  for (const merge of elements(document.getElementsByTagName("mergeCell"))) {
    const reference = merge.getAttribute("ref")
    if (reference) {
      merge.setAttribute("ref", shiftRangeReference(reference, fromRow, count))
    }
  }

  const allElements = elements(document.getElementsByTagName("*"))
  for (const element of allElements) {
    const name = element.localName || element.nodeName
    if (!["c", "row", "mergeCell", "dimension"].includes(name)) {
      for (const attribute of ["ref", "sqref", "topLeftCell", "activeCell"]) {
        const value = element.getAttribute(attribute)
        if (value) {
          element.setAttribute(
            attribute,
            shiftRangeReference(value, fromRow, count)
          )
        }
      }
    }
    if (name === "brk") {
      const id = Number(element.getAttribute("id"))
      if (Number.isInteger(id) && id >= templateRow) {
        element.setAttribute("id", String(id + count))
      }
    }
  }
}

function appendClonedMerges(
  document: XmlDocument,
  templateMergeRefs: string[],
  templateRow: number,
  lineCount: number
) {
  if (lineCount <= 1 || templateMergeRefs.length === 0) return
  let mergeCells = elements(document.getElementsByTagName("mergeCells"))[0]
  if (!mergeCells) {
    const worksheet = document.documentElement
    mergeCells = document.createElementNS(worksheet.namespaceURI, "mergeCells")
    worksheet.appendChild(mergeCells)
  }
  for (let index = 1; index < lineCount; index += 1) {
    const targetRow = templateRow + index
    for (const reference of templateMergeRefs) {
      const [startRaw, endRaw = startRaw] = reference.split(":")
      const start = referenceWithRow(startRaw, targetRow)
      const end = referenceWithRow(endRaw, targetRow)
      const merge = document.createElementNS(
        document.documentElement.namespaceURI,
        "mergeCell"
      )
      merge.setAttribute("ref", `${start}:${end}`)
      mergeCells.appendChild(merge)
    }
  }
  mergeCells.setAttribute(
    "count",
    String(elements(mergeCells.getElementsByTagName("mergeCell")).length)
  )
}

function fillLineCells(
  document: XmlDocument,
  row: XmlElement,
  sharedStrings: SharedStrings,
  line: Torg1Line,
  index: number,
  clearStaticValues: boolean
) {
  for (const cell of rowCells(row)) {
    const source = readCellSource(cell, sharedStrings)
    if (LINE_TEMPLATE_RE.test(source.text)) {
      setCellText(
        document,
        cell,
        substituteLineVariables(source.text, line, index),
        source.richNode
      )
    } else if (clearStaticValues && source.text !== "") {
      setCellText(document, cell, "", source.richNode)
    }
  }
}

function expandLineRows(
  document: XmlDocument,
  sharedStrings: SharedStrings,
  inputLines: Torg1Line[]
): boolean {
  const templateRows = elements(document.getElementsByTagName("row"))
    .filter((row) => rowHasLineTemplate(row, sharedStrings))
    .sort((left, right) => Number(right.getAttribute("r")) - Number(left.getAttribute("r")))

  if (templateRows.length === 0) return false
  const lines =
    inputLines.length > 0
      ? inputLines
      : [
          {
            lineNo: 1,
            name: "",
            itemCode: "",
            uom: "шт",
            qtyDoc: "",
            qtyFact: "",
            lotCode: "",
            note: "",
          },
        ]

  for (const row of templateRows) {
    const templateRow = Number(row.getAttribute("r"))
    if (!Number.isInteger(templateRow)) continue
    const rowTemplate = row.cloneNode(true) as XmlElement
    const templateMergeRefs = elements(document.getElementsByTagName("mergeCell"))
      .map((merge) => merge.getAttribute("ref") ?? "")
      .filter((reference) => {
        const rows = mergeRows(reference)
        return rows?.start === templateRow && rows.end === templateRow
      })

    const extra = lines.length - 1
    shiftWorksheetReferences(document, templateRow, extra)
    appendClonedMerges(document, templateMergeRefs, templateRow, lines.length)

    fillLineCells(document, row, sharedStrings, lines[0], 0, false)

    const insertionPoint = row.nextSibling
    for (let index = 1; index < lines.length; index += 1) {
      const clone = rowTemplate.cloneNode(true) as XmlElement
      setRowNumber(clone, templateRow + index)
      fillLineCells(document, clone, sharedStrings, lines[index], index, true)
      row.parentNode?.insertBefore(clone, insertionPoint)
    }
  }
  return true
}

function fillScalarVariables(
  document: XmlDocument,
  sharedStrings: SharedStrings,
  variables: Record<string, string>
): boolean {
  let changed = false
  for (const cell of elements(document.getElementsByTagName("c"))) {
    const source = readCellSource(cell, sharedStrings)
    if (!source.text.includes("{{")) continue
    const next = substituteVariables(source.text, variables)
    if (next === source.text) continue
    setCellText(document, cell, next, source.richNode)
    changed = true
  }
  return changed
}

function patchWorksheet(
  bytes: Uint8Array,
  sharedStrings: SharedStrings,
  variables: Record<string, string>,
  lines: Torg1Line[]
): Uint8Array | null {
  const document = parseXml(bytes)
  const expanded = expandLineRows(document, sharedStrings, lines)
  const substituted = fillScalarVariables(document, sharedStrings, variables)
  return expanded || substituted ? serializeXml(document) : null
}

export function fillTorg1XlsxPreservingLayout(
  templateBytes: ArrayBuffer,
  variables: Record<string, string>,
  lines: Torg1Line[]
): ArrayBuffer {
  const archive = unzipSync(new Uint8Array(templateBytes))
  const sharedStrings = readSharedStrings(archive)

  for (const path of Object.keys(archive)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/i.test(path)) continue
    const patched = patchWorksheet(
      archive[path],
      sharedStrings,
      variables,
      lines
    )
    if (patched) archive[path] = Uint8Array.from(patched)
  }

  const output = zipSync(archive, { level: 6 })
  return output.buffer.slice(
    output.byteOffset,
    output.byteOffset + output.byteLength
  ) as ArrayBuffer
}
