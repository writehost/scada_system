import path from "node:path"
import { mkdir, readFile, writeFile, unlink, access, readdir } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { unzipSync, strFromU8 } from "fflate"

export type Torg1ExcelTemplateSlot = {
  key: string
  label: string
  documentType: string
  categoryCode: string | null
  originalName: string
  updatedAt: string
  bytes: number
  sheets: string[]
  variables: string[]
}

type TemplateIndex = {
  version: 1
  templates: Torg1ExcelTemplateSlot[]
}

function legacyRoot(): string {
  return path.join(process.cwd(), "public", "torg1-templates")
}

function sharedRoot(): string {
  const shared = (process.env.WMS_SHARED_DIR ?? "").trim()
  if (shared) return path.join(shared, "uploads", "torg1-templates")

  const cwd = process.cwd()
  const currentMarker = `${path.sep}current${path.sep}`
  const markerIndex = cwd.toLowerCase().indexOf(currentMarker.toLowerCase())
  if (markerIndex >= 0) {
    const installRoot = cwd.slice(0, markerIndex)
    return path.join(installRoot, "shared", "uploads", "torg1-templates")
  }

  return legacyRoot()
}

function sanitizeSlotKey(raw: string): string {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return key || "default"
}

export function getTorg1ExcelTemplatePath(siteId: number, slotKey = "default"): string {
  const key = sanitizeSlotKey(slotKey)
  if (key === "default") return path.join(sharedRoot(), `site-${siteId}.xlsx`)
  return path.join(sharedRoot(), `site-${siteId}--${key}.xlsx`)
}

function getTorg1ExcelTemplateIndexPath(siteId: number): string {
  return path.join(sharedRoot(), `site-${siteId}-index.json`)
}

export async function ensureTorg1ExcelTemplateDir(): Promise<string> {
  const dir = sharedRoot()
  await mkdir(dir, { recursive: true })
  return dir
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}

function inspectXlsx(bytes: Buffer): { sheets: string[]; variables: string[] } {
  try {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      return { sheets: [], variables: [] }
    }
    const archive = unzipSync(new Uint8Array(bytes))
    const workbookXml = archive["xl/workbook.xml"]
    const sheets: string[] = []
    if (workbookXml) {
      const xml = strFromU8(workbookXml)
      const re = /<sheet\b[^>]*\bname="([^"]+)"/gi
      let match: RegExpExecArray | null
      while ((match = re.exec(xml))) sheets.push(match[1])
    }

    const found = new Set<string>()
    const varRe = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g
    for (const [entry, data] of Object.entries(archive)) {
      if (!/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/i.test(entry)) continue
      const text = strFromU8(data)
      let match: RegExpExecArray | null
      varRe.lastIndex = 0
      while ((match = varRe.exec(text))) found.add(match[1])
    }
    return { sheets, variables: [...found].sort((a, b) => a.localeCompare(b)) }
  } catch {
    return { sheets: [], variables: [] }
  }
}

async function readIndex(siteId: number): Promise<TemplateIndex> {
  try {
    const raw = await readFile(getTorg1ExcelTemplateIndexPath(siteId), "utf8")
    const parsed = JSON.parse(raw) as TemplateIndex
    if (!parsed || !Array.isArray(parsed.templates)) return { version: 1, templates: [] }
    return { version: 1, templates: parsed.templates }
  } catch {
    return { version: 1, templates: [] }
  }
}

async function writeIndex(siteId: number, index: TemplateIndex): Promise<void> {
  await ensureTorg1ExcelTemplateDir()
  await writeFile(
    getTorg1ExcelTemplateIndexPath(siteId),
    JSON.stringify({ version: 1, templates: index.templates }, null, 2),
    "utf8"
  )
}

async function migrateLegacyDefault(siteId: number): Promise<TemplateIndex> {
  const index = await readIndex(siteId)
  const defaultPath = getTorg1ExcelTemplatePath(siteId, "default")
  const legacy = path.join(legacyRoot(), `site-${siteId}.xlsx`)

  let bytes: Buffer | null = null
  if (await fileExists(defaultPath)) {
    bytes = await readFile(defaultPath)
  } else if (legacy !== defaultPath && (await fileExists(legacy))) {
    bytes = await readFile(legacy)
    await ensureTorg1ExcelTemplateDir()
    await writeFile(defaultPath, bytes)
  }

  if (!bytes) return index

  const existing = index.templates.find((item) => item.key === "default")
  if (existing && existing.bytes === bytes.length) return index

  const inspected = inspectXlsx(bytes)
  const next: Torg1ExcelTemplateSlot = {
    key: "default",
    label: existing?.label || "Приёмка — общий",
    documentType: existing?.documentType || "receiving",
    categoryCode: existing?.categoryCode ?? null,
    originalName: existing?.originalName || "TORG-1-shablon.xlsx",
    updatedAt: existing?.updatedAt || new Date().toISOString(),
    bytes: bytes.length,
    sheets: inspected.sheets,
    variables: inspected.variables,
  }

  const templates = [
    next,
    ...index.templates.filter((item) => item.key !== "default"),
  ]
  const migrated = { version: 1 as const, templates }
  await writeIndex(siteId, migrated)
  return migrated
}

export async function listTorg1ExcelTemplates(siteId: number): Promise<Torg1ExcelTemplateSlot[]> {
  const index = await migrateLegacyDefault(siteId)
  const alive: Torg1ExcelTemplateSlot[] = []
  for (const item of index.templates) {
    if (await fileExists(getTorg1ExcelTemplatePath(siteId, item.key))) {
      alive.push(item)
    }
  }
  if (alive.length !== index.templates.length) {
    await writeIndex(siteId, { version: 1, templates: alive })
  }
  return alive
}

export async function torg1ExcelTemplateExists(
  siteId: number,
  slotKey = "default"
): Promise<boolean> {
  const templates = await listTorg1ExcelTemplates(siteId)
  if (slotKey === "default") return templates.some((item) => item.key === "default")
  return templates.some((item) => item.key === sanitizeSlotKey(slotKey))
}

export async function readTorg1ExcelTemplate(
  siteId: number,
  slotKey = "default"
): Promise<Buffer | null> {
  await migrateLegacyDefault(siteId)
  const target = getTorg1ExcelTemplatePath(siteId, slotKey)
  try {
    return await readFile(target)
  } catch {
    if (sanitizeSlotKey(slotKey) !== "default") return null
    const legacy = path.join(legacyRoot(), `site-${siteId}.xlsx`)
    if (legacy === target) return null
    try {
      const bytes = await readFile(legacy)
      await ensureTorg1ExcelTemplateDir()
      await writeFile(target, bytes)
      return bytes
    } catch {
      return null
    }
  }
}

export async function resolveTorg1ExcelTemplate(
  siteId: number,
  input?: { documentType?: string | null; categoryCode?: string | null; slot?: string | null }
): Promise<{ slot: string; bytes: Buffer } | null> {
  const templates = await listTorg1ExcelTemplates(siteId)
  if (templates.length === 0) return null

  const explicit = sanitizeSlotKey(input?.slot || "")
  if (input?.slot) {
    const bytes = await readTorg1ExcelTemplate(siteId, explicit)
    return bytes ? { slot: explicit, bytes } : null
  }

  const documentType = (input?.documentType || "").trim().toLowerCase()
  const categoryCode = (input?.categoryCode || "").trim().toLowerCase()

  const byCategory =
    documentType && categoryCode
      ? templates.find(
          (item) =>
            item.documentType === documentType &&
            (item.categoryCode || "").toLowerCase() === categoryCode
        )
      : undefined
  if (byCategory) {
    const bytes = await readTorg1ExcelTemplate(siteId, byCategory.key)
    if (bytes) return { slot: byCategory.key, bytes }
  }

  const byType = documentType
    ? templates.find(
        (item) => item.documentType === documentType && !item.categoryCode && item.key !== "default"
      )
    : undefined
  if (byType) {
    const bytes = await readTorg1ExcelTemplate(siteId, byType.key)
    if (bytes) return { slot: byType.key, bytes }
  }

  const fallback = templates.find((item) => item.key === "default") || templates[0]
  const bytes = await readTorg1ExcelTemplate(siteId, fallback.key)
  return bytes ? { slot: fallback.key, bytes } : null
}

export async function writeTorg1ExcelTemplate(
  siteId: number,
  bytes: Buffer,
  meta?: {
    slot?: string
    label?: string
    documentType?: string
    categoryCode?: string | null
    originalName?: string
  }
): Promise<Torg1ExcelTemplateSlot> {
  await ensureTorg1ExcelTemplateDir()
  const key = sanitizeSlotKey(meta?.slot || "default")
  const filePath = getTorg1ExcelTemplatePath(siteId, key)
  await writeFile(filePath, bytes)

  const inspected = inspectXlsx(bytes)
  const index = await listTorg1ExcelTemplates(siteId)
  const previous = index.find((item) => item.key === key)
  const next: Torg1ExcelTemplateSlot = {
    key,
    label:
      (meta?.label || "").trim() ||
      previous?.label ||
      (key === "default" ? "Приёмка — общий" : key),
    documentType: (meta?.documentType || previous?.documentType || "receiving").trim() || "receiving",
    categoryCode:
      meta?.categoryCode === undefined
        ? previous?.categoryCode ?? null
        : meta.categoryCode?.trim() || null,
    originalName: (meta?.originalName || previous?.originalName || "template.xlsx").trim(),
    updatedAt: new Date().toISOString(),
    bytes: bytes.length,
    sheets: inspected.sheets,
    variables: inspected.variables,
  }

  const templates = [next, ...index.filter((item) => item.key !== key)].sort((a, b) => {
    if (a.key === "default") return -1
    if (b.key === "default") return 1
    return a.label.localeCompare(b.label, "ru")
  })
  await writeIndex(siteId, { version: 1, templates })
  return next
}

export async function deleteTorg1ExcelTemplate(
  siteId: number,
  slotKey = "default"
): Promise<boolean> {
  const key = sanitizeSlotKey(slotKey)
  const target = getTorg1ExcelTemplatePath(siteId, key)
  let deleted = false
  try {
    await unlink(target)
    deleted = true
  } catch {
    // absent
  }

  if (key === "default") {
    const legacy = path.join(legacyRoot(), `site-${siteId}.xlsx`)
    if (legacy !== target) {
      try {
        await unlink(legacy)
        deleted = true
      } catch {
        // absent
      }
    }
  }

  const index = await readIndex(siteId)
  const templates = index.templates.filter((item) => item.key !== key)
  await writeIndex(siteId, { version: 1, templates })
  return deleted
}

export async function listOrphanTemplateFiles(siteId: number): Promise<string[]> {
  try {
    const files = await readdir(sharedRoot())
    return files.filter(
      (name) =>
        name === `site-${siteId}.xlsx` ||
        name.startsWith(`site-${siteId}--`) ||
        name === `site-${siteId}-index.json`
    )
  } catch {
    return []
  }
}
