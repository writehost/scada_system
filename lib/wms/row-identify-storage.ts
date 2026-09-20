import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { withRowIdentifyCounts, type RowIdentifySession } from "./row-identify-types"

function sharedRoot(): string {
  const shared = (process.env.WMS_SHARED_DIR ?? "").trim()
  if (shared) return path.join(shared, "uploads", "fg-row-identify")

  const cwd = process.cwd()
  const currentMarker = `${path.sep}current${path.sep}`
  const markerIndex = cwd.toLowerCase().indexOf(currentMarker.toLowerCase())
  if (markerIndex >= 0) {
    return path.join(cwd.slice(0, markerIndex), "shared", "uploads", "fg-row-identify")
  }
  return path.join(process.cwd(), "public", "fg-row-identify")
}

function sessionPath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "")
  return path.join(sharedRoot(), `session-${safe}.json`)
}

export async function readRowIdentifySession(id: string): Promise<RowIdentifySession | null> {
  try {
    const raw = await readFile(sessionPath(id), "utf8")
    const parsed = JSON.parse(raw) as RowIdentifySession
    if (!parsed?.id) return null
    return withRowIdentifyCounts(parsed)
  } catch {
    return null
  }
}

export async function writeRowIdentifySession(session: RowIdentifySession): Promise<RowIdentifySession> {
  await mkdir(sharedRoot(), { recursive: true })
  const next = withRowIdentifyCounts({ ...session, updatedAt: new Date().toISOString() })
  await writeFile(sessionPath(session.id), JSON.stringify(next, null, 2), "utf8")
  return next
}
