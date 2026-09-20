import fs from "node:fs"
import path from "node:path"

export type BuildMeta = { buildId: string; builtAt: string | null }

export function readLocalBuildMeta(): BuildMeta {
  const envId = process.env.WMS_APP_BUILD_ID?.trim()
  if (envId) {
    return {
      buildId: envId,
      builtAt: process.env.WMS_APP_BUILT_AT?.trim() || null,
    }
  }

  const filePath = path.join(process.cwd(), "public", "wms-build-id.json")
  if (fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<BuildMeta>
      const buildId = String(raw.buildId ?? "").trim()
      if (buildId) {
        return { buildId, builtAt: raw.builtAt ? String(raw.builtAt) : null }
      }
    } catch {
      /* ignore */
    }
  }

  return { buildId: "dev", builtAt: null }
}

export function writeLocalBuildMeta(meta: BuildMeta) {
  const publicDir = path.join(process.cwd(), "public")
  fs.mkdirSync(publicDir, { recursive: true })
  fs.writeFileSync(
    path.join(publicDir, "wms-build-id.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8"
  )
}
