import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { WmsReleaseInfo } from "@/lib/update-server-client"
import { downloadPackageToFile } from "@/lib/server/package-download"

function packageUrlFor(release: WmsReleaseInfo, updateServerUrl: string): string | null {
  const raw = release.packageUrl?.trim()
  if (!raw) return null
  if (raw.startsWith("http")) return raw
  const base = updateServerUrl.replace(/\/$/, "")
  return `${base}${raw.startsWith("/") ? raw : `/${raw}`}`
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8" })
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || `${cmd} failed`).trim())
  }
  return r.stdout
}

function extractZipLinux(archive: string, dest: string) {
  const py = path.join(dest, "_extract_zip.py")
  fs.writeFileSync(
    py,
    `import os, sys, zipfile
archive, dest = sys.argv[1], sys.argv[2]
os.makedirs(dest, exist_ok=True)
with zipfile.ZipFile(archive) as z:
    for m in z.infolist():
        name = m.filename.replace("\\\\", "/").lstrip("/")
        if not name or name.startswith("../") or "/../" in name:
            continue
        target = os.path.join(dest, name)
        if m.is_dir() or name.endswith("/"):
            os.makedirs(target, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(target) or dest, exist_ok=True)
        with z.open(m) as src, open(target, "wb") as out:
            out.write(src.read())
`,
    "utf8"
  )
  try {
    run("python3", [py, archive, dest])
  } finally {
    fs.rmSync(py, { force: true })
  }
}

function extractReleasePackage(archive: string, dest: string) {
  if (archive.endsWith(".tar.gz") || archive.endsWith(".tgz")) {
    run("tar", ["-xzf", archive, "-C", dest])
    return
  }
  if (archive.endsWith(".zip")) {
    extractZipLinux(archive, dest)
    return
  }
  throw new Error(`unsupported update package archive: ${path.basename(archive)}`)
}

function findApplyScript(root: string): string | null {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const full = path.join(dir, name)
      let st: fs.Stats
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (name === "apply-wms-update.mjs") return full
    }
  }
  return null
}

/** Перед apply: взять свежие scripts/ из пакета на scada25 (без SSH на 10.26). */
export async function bootstrapScriptsFromRelease(
  release: WmsReleaseInfo,
  repoRoot: string,
  updateServerUrl: string
): Promise<void> {
  if (process.platform === "win32") return

  const url = packageUrlFor(release, updateServerUrl)
  if (!url) return

  const tmp = path.join(repoRoot, ".wms-update-bootstrap")
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })

  const archive = path.join(tmp, path.basename(release.packageName || "release.tgz"))
  await downloadPackageToFile(url, archive, release.packageName)
  extractReleasePackage(archive, tmp)

  const found = findApplyScript(tmp)
  if (!found) {
    throw new Error("apply-wms-update.mjs not found in release package")
  }

  const scriptsSrc = path.dirname(found)
  const scriptsDest = path.join(repoRoot, "scripts")
  fs.mkdirSync(scriptsDest, { recursive: true })
  run("rsync", ["-a", `${scriptsSrc}/`, `${scriptsDest}/`])
  for (const scriptName of ["apply-wms-update-10.26.sh", "restart-wms-ui-10.26.sh"]) {
    const scriptPath = path.join(scriptsDest, scriptName)
    if (fs.existsSync(scriptPath)) {
      const normalized = fs.readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      fs.writeFileSync(scriptPath, normalized, "utf8")
      fs.chmodSync(scriptPath, 0o755)
    }
  }
}

export function ensureUpdateEnvLocal(uiCwd: string, updateServerUrl: string) {
  const envPath = path.join(uiCwd, ".env.local")
  const repoRoot = uiCwd.replace(/\\/g, "/").endsWith("/Frontend")
    ? path.resolve(uiCwd, "..")
    : path.resolve(uiCwd, "..", "..")
  const applyScript = path.join(repoRoot, "scripts", "apply-wms-update-10.26.sh")
  const want: Record<string, string> = {
    WMS_UPDATE_SERVER_URL: process.env.WMS_UPDATE_SERVER_URL || updateServerUrl || "https://scada25.ru",
    WMS_UPDATE_SERVER_TOKEN: process.env.WMS_UPDATE_SERVER_TOKEN || "",
    WMS_UPDATE_SERVER_INSECURE_TLS: process.env.WMS_UPDATE_SERVER_INSECURE_TLS || "1",
  }
  if (process.platform !== "win32") {
    want.WMS_ROOT = repoRoot
    want.FRONTEND = uiCwd
    want.WMS_UPDATE_APPLY_SCRIPT = fs.existsSync(process.env.WMS_UPDATE_APPLY_SCRIPT || "")
      ? process.env.WMS_UPDATE_APPLY_SCRIPT || ""
      : applyScript
  }
  const map = new Map<string, string>()
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim()
      if (!t || t.startsWith("#")) continue
      const i = t.indexOf("=")
      if (i > 0) map.set(t.slice(0, i), t.slice(i + 1))
    }
  }
  for (const [k, v] of Object.entries(want)) {
    if (v && !map.has(k)) map.set(k, v)
  }
  const configuredApplyScript = map.get("WMS_UPDATE_APPLY_SCRIPT")
  if (configuredApplyScript && !fs.existsSync(configuredApplyScript)) {
    map.set("WMS_UPDATE_APPLY_SCRIPT", want.WMS_UPDATE_APPLY_SCRIPT)
  }
  const body = [...map.entries()].map(([k, v]) => `${k}=${v}`).join("\n") + "\n"
  try {
    fs.writeFileSync(envPath, body, "utf8")
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === "EACCES") {
      const sharedEnv = path.join(repoRoot, "shared", "frontend.env.local")
      fs.mkdirSync(path.dirname(sharedEnv), { recursive: true })
      fs.writeFileSync(sharedEnv, body, "utf8")
      return
    }
    throw e
  }
}
