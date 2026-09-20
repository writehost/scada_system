import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"

export type FgPlanAprilTagBin = {
  row: string
  azMin: number
  azMax: number
}

export type FgPlanAprilTagCoverage = {
  leftRowId: string
  centerRowId: string
  rightRowId: string
  rows: string[]
  bins: FgPlanAprilTagBin[]
}

export type FgPlanAprilTagPoint = {
  id: string
  tagId: number
  x: number
  y: number
  label?: string
  coverage?: FgPlanAprilTagCoverage
}

export type FgPlanAprilTagsSnapshot = {
  version: 1
  updatedAt: string
  family: "tag36h11"
  tags: FgPlanAprilTagPoint[]
}

function sharedRoot(): string {
  const shared = (process.env.WMS_SHARED_DIR ?? "").trim()
  if (shared) return path.join(shared, "uploads", "fg-plan-apriltags")

  const cwd = process.cwd()
  const currentMarker = `${path.sep}current${path.sep}`
  const markerIndex = cwd.toLowerCase().indexOf(currentMarker.toLowerCase())
  if (markerIndex >= 0) {
    const installRoot = cwd.slice(0, markerIndex)
    return path.join(installRoot, "shared", "uploads", "fg-plan-apriltags")
  }

  return path.join(process.cwd(), "public", "fg-plan-apriltags")
}

function tagsPath(siteId: number): string {
  return path.join(sharedRoot(), `site-${siteId}.json`)
}

function asFinite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeCoverage(raw: unknown): FgPlanAprilTagCoverage | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const row = raw as Record<string, unknown>
  const rows = Array.isArray(row.rows) ? row.rows.map(item => String(item || "").trim()).filter(Boolean) : []
  if (rows.length === 0) return undefined
  const bins = Array.isArray(row.bins)
    ? row.bins.flatMap(item => {
        if (!item || typeof item !== "object") return []
        const bin = item as Record<string, unknown>
        const azMin = asFinite(bin.azMin)
        const azMax = asFinite(bin.azMax)
        const rowId = String(bin.row || "").trim()
        if (!rowId || azMin == null || azMax == null) return []
        return [{ row: rowId, azMin, azMax }]
      })
    : []
  return {
    leftRowId: String(row.leftRowId || rows[0] || "").trim(),
    centerRowId: String(row.centerRowId || rows[Math.floor((rows.length - 1) / 2)] || "").trim(),
    rightRowId: String(row.rightRowId || rows[rows.length - 1] || "").trim(),
    rows,
    bins,
  }
}

export function normalizePlanAprilTags(raw: unknown): FgPlanAprilTagPoint[] {
  if (!Array.isArray(raw)) return []
  const out: FgPlanAprilTagPoint[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const x = asFinite(row.x)
    const y = asFinite(row.y)
    if (x == null || y == null) continue
    const tagIdRaw = asFinite(row.tagId)
    const tagId = tagIdRaw != null && tagIdRaw >= 0 ? Math.round(tagIdRaw) : out.length
    const coverage = normalizeCoverage(row.coverage)
    out.push({
      id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `tag-${out.length + 1}`,
      tagId,
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : undefined,
      coverage,
    })
  }
  return out
}

export function toPhoneAprilTagMap(tags: FgPlanAprilTagPoint[]) {
  return {
    family: "tag36h11" as const,
    defaultSizeM: 0.2,
    tags: tags
      .filter(tag => (tag.coverage?.rows.length ?? 0) > 0)
      .map(tag => ({
        id: tag.tagId,
        zone: (tag.coverage?.rows[0] || "A-1").split("-")[0] || "A",
        mode: (tag.coverage?.rows.length ?? 0) <= 1 ? "direct" : "pose",
        sizeM: 0.2,
        rows: tag.coverage?.rows ?? [],
        bins: tag.coverage?.bins ?? [],
        x: tag.x,
        y: tag.y,
        label: tag.label,
      })),
  }
}

export async function readFgPlanAprilTags(siteId: number): Promise<FgPlanAprilTagsSnapshot> {
  const filePath = tagsPath(siteId)
  try {
    const raw = await readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as FgPlanAprilTagsSnapshot
    if (parsed?.version === 1 && Array.isArray(parsed.tags)) {
      return {
        version: 1,
        updatedAt: parsed.updatedAt,
        family: "tag36h11",
        tags: normalizePlanAprilTags(parsed.tags),
      }
    }
  } catch {
    /* empty */
  }
  return { version: 1, updatedAt: new Date(0).toISOString(), family: "tag36h11", tags: [] }
}

export async function writeFgPlanAprilTags(
  siteId: number,
  tags: FgPlanAprilTagPoint[]
): Promise<FgPlanAprilTagsSnapshot> {
  const dir = sharedRoot()
  await mkdir(dir, { recursive: true })
  const snapshot: FgPlanAprilTagsSnapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    family: "tag36h11",
    tags: normalizePlanAprilTags(tags),
  }
  await writeFile(tagsPath(siteId), JSON.stringify(snapshot, null, 2), "utf8")
  return snapshot
}
