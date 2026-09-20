import path from "node:path"
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import * as XLSX from "xlsx"
import {
  TORG16_VARIABLE_KEYS,
  torg16FieldsToVarMap,
  type Torg16Fields,
} from "@/lib/wms/torg16"

export type Torg16TemplateMeta = {
  originalName: string
  mimeType: string
  updatedAt: string
  bytes: number
  kind: "xlsx" | "docx"
  variables: string[]
}

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

function sharedRoot(): string {
  const shared = (process.env.WMS_SHARED_DIR ?? "").trim()
  if (shared) return path.join(shared, "uploads", "torg16-templates")
  const cwd = process.cwd()
  const currentMarker = `${path.sep}current${path.sep}`
  const markerIndex = cwd.toLowerCase().indexOf(currentMarker.toLowerCase())
  if (markerIndex >= 0) {
    return path.join(cwd.slice(0, markerIndex), "shared", "uploads", "torg16-templates")
  }
  return path.join(cwd, "public", "torg16-templates")
}

function filePath(siteId: number, ext: string): string {
  return path.join(sharedRoot(), `site-${siteId}.${ext}`)
}

function metaPath(siteId: number): string {
  return path.join(sharedRoot(), `site-${siteId}-meta.json`)
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}

export async function ensureTorg16TemplateDir(): Promise<string> {
  const dir = sharedRoot()
  await mkdir(dir, { recursive: true })
  return dir
}

function detectKind(name: string, mime: string, bytes: Buffer): "xlsx" | "docx" | null {
  const lower = name.toLowerCase()
  if (lower.endsWith(".xls") && !lower.endsWith(".xlsx")) return null
  if (lower.endsWith(".doc") && !lower.endsWith(".docx")) return null
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null
  if (lower.endsWith(".xlsx") || mime.includes("spreadsheetml")) return "xlsx"
  if (lower.endsWith(".docx") || mime.includes("wordprocessingml")) return "docx"
  try {
    const archive = unzipSync(new Uint8Array(bytes))
    if (archive["word/document.xml"]) return "docx"
    if (archive["xl/workbook.xml"]) return "xlsx"
  } catch {
    /* ignore */
  }
  return null
}

function extractVariables(bytes: Buffer, kind: "xlsx" | "docx"): string[] {
  try {
    const archive = unzipSync(new Uint8Array(bytes))
    const found = new Set<string>()
    for (const [entry, data] of Object.entries(archive)) {
      const keep =
        kind === "xlsx"
          ? /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/i.test(entry)
          : /^word\/.+\.xml$/i.test(entry)
      if (!keep) continue
      const text = strFromU8(data)
      VAR_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = VAR_RE.exec(text))) found.add(match[1])
    }
    return [...found].sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

function replacePlaceholders(text: string, vars: Record<string, string>): string {
  return text.replace(VAR_RE, (_m, key: string) => vars[key] ?? "")
}

function fillXlsx(bytes: Buffer, vars: Record<string, string>): Buffer {
  const wb = XLSX.read(bytes, { type: "buffer", cellStyles: true })
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws || !ws["!ref"]) continue
    const range = XLSX.utils.decode_range(ws["!ref"])
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr] as XLSX.CellObject | undefined
        if (!cell || cell.v == null) continue
        const raw = String(cell.v)
        if (!raw.includes("{{")) continue
        cell.t = "s"
        cell.v = replacePlaceholders(raw, vars)
        delete cell.w
        delete cell.f
      }
    }
  }
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  return Buffer.isBuffer(out) ? out : Buffer.from(out)
}

function fillDocx(bytes: Buffer, vars: Record<string, string>): Buffer {
  const archive = unzipSync(new Uint8Array(bytes))
  const next: Record<string, Uint8Array> = {}
  for (const [entry, data] of Object.entries(archive)) {
    if (!/^word\/.+\.xml$/i.test(entry)) {
      next[entry] = data
      continue
    }
    next[entry] = strToU8(replacePlaceholders(strFromU8(data), vars))
  }
  return Buffer.from(zipSync(next))
}

export function buildTorg16StarterXlsx(fields?: Torg16Fields): Buffer {
  const vars = fields ? torg16FieldsToVarMap(fields) : {}
  const wb = XLSX.utils.book_new()
  const header = [
    ["Акт о списании товаров (ТОРГ-16)"],
    ["Организация", "{{orgName}}"],
    ["Адрес", "{{orgAddress}}"],
    ["ОКПО", "{{okpo}}"],
    ["ОКУД", "{{okud}}"],
    ["Склад / подразделение", "{{structuralUnit}}"],
    ["Номер", "{{documentNo}}"],
    ["Дата", "{{composedAt}}"],
    ["Основание", "{{reasonName}}"],
    ["Ячейка", "{{locationCode}} {{locationName}}"],
    [],
    ["№", "Наименование", "Код", "ЕИ", "Кол-во", "Партия", "Срок", "Коды"],
    [
      "{{line.lineNo}}",
      "{{line.name}}",
      "{{line.itemCode}}",
      "{{line.uom}}",
      "{{line.qty}}",
      "{{line.lotCode}}",
      "{{line.expiryAt}}",
      "{{line.codes}}",
    ],
    [],
    ["Списанные коды"],
    ["{{codes}}"],
    [],
    ["Переменные для шаблона Word/Excel"],
    ...TORG16_VARIABLE_KEYS.map((item) => [`{{${item.key}}}`, item.hint, vars[item.key] ?? ""]),
  ]
  const sheet = XLSX.utils.aoa_to_sheet(header)
  XLSX.utils.book_append_sheet(wb, sheet, "ТОРГ-16")
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  return Buffer.isBuffer(out) ? out : Buffer.from(out)
}

export async function getTorg16TemplateMeta(siteId: number): Promise<Torg16TemplateMeta | null> {
  try {
    const raw = await readFile(metaPath(siteId), "utf8")
    const parsed = JSON.parse(raw) as Torg16TemplateMeta
    if (!parsed?.kind) return null
    return parsed
  } catch {
    return null
  }
}

export async function readTorg16TemplateBytes(
  siteId: number
): Promise<{ bytes: Buffer; meta: Torg16TemplateMeta } | null> {
  const meta = await getTorg16TemplateMeta(siteId)
  if (!meta) return null
  const p = filePath(siteId, meta.kind)
  if (!(await fileExists(p))) return null
  const bytes = await readFile(p)
  return { bytes, meta }
}

export async function saveTorg16Template(
  siteId: number,
  file: { name: string; type?: string; bytes: Buffer }
): Promise<Torg16TemplateMeta> {
  const kind = detectKind(file.name, file.type || "", file.bytes)
  if (!kind) {
    throw new Error("Нужен .docx или .xlsx. Старый .doc сохраните в Word как «Документ Word (*.docx)».")
  }
  await ensureTorg16TemplateDir()
  const prev = await getTorg16TemplateMeta(siteId)
  if (prev && prev.kind !== kind) {
    try {
      await unlink(filePath(siteId, prev.kind))
    } catch {
      /* ignore */
    }
  }
  await writeFile(filePath(siteId, kind), file.bytes)
  const meta: Torg16TemplateMeta = {
    originalName: file.name,
    mimeType:
      kind === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    updatedAt: new Date().toISOString(),
    bytes: file.bytes.length,
    kind,
    variables: extractVariables(file.bytes, kind),
  }
  await writeFile(metaPath(siteId), JSON.stringify(meta, null, 2), "utf8")
  return meta
}

export async function deleteTorg16Template(siteId: number): Promise<void> {
  const meta = await getTorg16TemplateMeta(siteId)
  if (meta) {
    try {
      await unlink(filePath(siteId, meta.kind))
    } catch {
      /* ignore */
    }
  }
  try {
    await unlink(metaPath(siteId))
  } catch {
    /* ignore */
  }
}

export function fillTorg16Template(
  bytes: Buffer,
  kind: "xlsx" | "docx",
  fields: Torg16Fields
): Buffer {
  const vars = torg16FieldsToVarMap(fields)
  return kind === "xlsx" ? fillXlsx(bytes, vars) : fillDocx(bytes, vars)
}

export function torg16DownloadName(fields: Torg16Fields, kind: "xlsx" | "docx"): string {
  const no = (fields.documentNo || "akt").replace(/[^\w.-]+/g, "_")
  return `TORG-16-${no}.${kind}`
}
