import { spawnSync } from "node:child_process"
import fs from "node:fs"
import https from "node:https"
import path from "node:path"

const LOCAL_PACKAGES_DIR = "/opt/wms-update-server/data/packages"
const LOCAL_UPDATE_SERVER = "http://127.0.0.1:3090"

function localPackagePath(packageName: string): string | null {
  const safe = path.basename(packageName)
  const filePath = path.join(LOCAL_PACKAGES_DIR, safe)
  return fs.existsSync(filePath) ? filePath : null
}

function assertHttpUrl(raw: string): string {
  const parsed = new URL(raw)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("package url must be http(s)")
  }
  if (parsed.username || parsed.password) {
    throw new Error("package url must not contain credentials")
  }
  return parsed.href
}

/** Avoid HTTPS hairpin when UI and update-server are on the same host. */
export function resolvePackageDownloadTarget(
  url: string,
  packageName?: string | null
): { kind: "file"; path: string } | { kind: "url"; url: string } {
  const name = packageName?.trim() || ""
  if (name) {
    const local = localPackagePath(name)
    if (local) return { kind: "file", path: local }
  }

  try {
    const parsed = new URL(assertHttpUrl(url))
    if (parsed.pathname.startsWith("/packages/")) {
      const fromPath = localPackagePath(decodeURIComponent(parsed.pathname.slice("/packages/".length)))
      if (fromPath) return { kind: "file", path: fromPath }
      return { kind: "url", url: `${LOCAL_UPDATE_SERVER}${parsed.pathname}` }
    }
    return { kind: "url", url: parsed.href }
  } catch {
    throw new Error("invalid package url")
  }
}

function curlDownload(url: string, dest: string) {
  const r = spawnSync("curl", ["-fL", "--retry", "3", "--retry-delay", "2", "-o", dest, "--", url], {
    stdio: "pipe",
    timeout: 900000,
  })
  if (r.status !== 0) {
    throw new Error(Buffer.isBuffer(r.stderr) ? r.stderr.toString("utf8") : "curl failed")
  }
}

export async function downloadPackageToFile(url: string, dest: string, packageName?: string | null) {
  const target = resolvePackageDownloadTarget(url, packageName)
  if (target.kind === "file") {
    fs.copyFileSync(target.path, dest)
    return
  }

  const safeUrl = assertHttpUrl(target.url)
  if (process.platform !== "win32") {
    try {
      curlDownload(safeUrl, dest)
      return
    } catch {
      /* fall through to fetch */
    }
  }

  const insecure = process.env.WMS_UPDATE_SERVER_INSECURE_TLS === "1"
  const agent = insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined
  const res = await fetch(safeUrl, {
    signal: AbortSignal.timeout(900000),
    ...(agent ? { agent } : {}),
  } as RequestInit)
  if (!res.ok) throw new Error(`download package failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
}
