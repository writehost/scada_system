#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import https from "node:https"
import { execSync } from "node:child_process"
import { pipeline } from "node:stream/promises"
import { createWriteStream } from "node:fs"

function readPayload() {
  const fromEnv = process.env.WMS_UPDATE_PAYLOAD?.trim()
  if (fromEnv) return JSON.parse(fromEnv)
  const stdin = fs.readFileSync(0, "utf8").trim()
  if (!stdin) throw new Error("empty update payload")
  return JSON.parse(stdin)
}

async function downloadFile(url, dest) {
  const insecure = process.env.WMS_UPDATE_SERVER_INSECURE_TLS === "1"
  const agent = insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined
  const res = await fetch(url, {
    signal: AbortSignal.timeout(600000),
    ...(agent ? { agent } : {}),
  })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  await pipeline(res.body, createWriteStream(dest))
}

function isFrontendDir(dir) {
  return (
    fs.existsSync(path.join(dir, "package.json")) &&
    fs.existsSync(path.join(dir, "app"))
  )
}

function findPackageRoot(extractDir, frontendDir) {
  let dir = frontendDir
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, "scripts", "apply-wms-update.mjs"))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const ent of fs.readdirSync(extractDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const candidate = path.join(extractDir, ent.name)
    if (fs.existsSync(path.join(candidate, "scripts", "apply-wms-update.mjs"))) {
      return candidate
    }
  }
  return null
}

function syncPackageScripts(packageRoot, repoRoot) {
  const src = path.join(packageRoot, "scripts")
  const dest = path.join(repoRoot, "scripts")
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dest, { recursive: true })
  if (process.platform === "win32") {
    execSync(`robocopy "${src}" "${dest}" /E /NFL /NDL /NJH /NJS /NP`, { stdio: "inherit" })
  } else {
    execSync(`rsync -a "${src}/" "${dest}/"`, { stdio: "inherit" })
  }
}

function ensureEnvLocal(uiCwd, updateServerUrl) {
  const envPath = path.join(uiCwd, ".env.local")
  const want = {
    WMS_UPDATE_SERVER_URL: process.env.WMS_UPDATE_SERVER_URL || updateServerUrl || "https://scada25.ru",
    WMS_UPDATE_SERVER_TOKEN: process.env.WMS_UPDATE_SERVER_TOKEN || "",
    WMS_UPDATE_SERVER_INSECURE_TLS: process.env.WMS_UPDATE_SERVER_INSECURE_TLS || "1",
    WMS_UPDATE_APPLY_SCRIPT:
      process.env.WMS_UPDATE_APPLY_SCRIPT || "/var/www/wms/scripts/apply-wms-update-10.26.sh",
  }
  const map = new Map()
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
  const body = [...map.entries()].map(([k, v]) => `${k}=${v}`).join("\n") + "\n"
  fs.writeFileSync(envPath, body, "utf8")
}

function findFrontendDeployRoot(extractDir) {
  const queue = [extractDir]
  let depth = 0
  while (queue.length && depth < 8) {
    const levelSize = queue.length
    for (let i = 0; i < levelSize; i += 1) {
      const dir = queue.shift()
      if (!dir || !fs.existsSync(dir)) continue
      if (isFrontendDir(dir)) return dir
      let entries = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue
        const name = ent.name.replace(/\\/g, "/")
        const child = path.join(dir, name)
        if (name === "Frontend" && isFrontendDir(child)) return child
        queue.push(child)
      }
    }
    depth += 1
  }
  const hint = fs.readdirSync(extractDir).slice(0, 10).join(", ")
  throw new Error(`Frontend/ not found in package (extracted to ${extractDir}; top: ${hint})`)
}

function extractZipLinux(archivePath, extractDir) {
  // Windows Compress-Archive stores paths with backslashes — normalize on extract.
  const pyScript = path.join(extractDir, "..", "_extract_zip.py")
  const pyCode = `import os, sys, zipfile
dest = sys.argv[2]
os.makedirs(dest, exist_ok=True)
with zipfile.ZipFile(sys.argv[1]) as z:
    for m in z.infolist():
        name = m.filename.replace("\\\\", "/").lstrip("/")
        if not name:
            continue
        target = os.path.join(dest, name)
        if m.is_dir() or name.endswith("/"):
            os.makedirs(target, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(target) or dest, exist_ok=True)
        with z.open(m) as src, open(target, "wb") as out:
            out.write(src.read())
`
  fs.writeFileSync(pyScript, pyCode, "utf8")
  try {
    execSync(`python3 "${pyScript}" "${archivePath}" "${extractDir}"`, { stdio: "inherit" })
    fs.rmSync(pyScript, { force: true })
    return
  } catch (err) {
    fs.rmSync(pyScript, { force: true })
    throw err
  }
}

function fixFrontendAfterRsync(uiCwd, repoRoot, extractDir) {
  const scriptsDir = path.join(uiCwd, "scripts")
  fs.mkdirSync(scriptsDir, { recursive: true })
  const buildIdScript = "write-wms-build-id.mjs"
  const candidates = [
    path.join(repoRoot, "scripts", buildIdScript),
    path.join(extractDir, "scripts", buildIdScript),
  ]
  for (const ent of fs.readdirSync(extractDir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      candidates.push(path.join(extractDir, ent.name, "scripts", buildIdScript))
    }
  }
  for (const src of candidates) {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(scriptsDir, buildIdScript))
      break
    }
  }

  const pkgPath = path.join(uiCwd, "package.json")
  if (fs.existsSync(pkgPath)) {
    let buf = fs.readFileSync(pkgPath)
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3)
    let raw = buf.toString("utf8")
    raw = raw.replaceAll("../../../scripts/write-wms-build-id.mjs", "scripts/write-wms-build-id.mjs")
    raw = raw.replaceAll("../scripts/write-wms-build-id.mjs", "scripts/write-wms-build-id.mjs")
    fs.writeFileSync(pkgPath, raw, { encoding: "utf8" })
  }
}

function extractArchive(archivePath, extractDir) {
  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force"`,
        { stdio: "inherit" }
      )
      return
    }
    extractZipLinux(archivePath, extractDir)
    return
  }
  if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: "inherit" })
    return
  }
  throw new Error(`unsupported archive: ${archivePath}`)
}

function writeBuildId(uiCwd, buildId, builtAt) {
  const publicDir = path.join(uiCwd, "public")
  fs.mkdirSync(publicDir, { recursive: true })
  fs.writeFileSync(
    path.join(publicDir, "wms-build-id.json"),
    `${JSON.stringify({ buildId, builtAt: builtAt || new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  )
}

function updateJob(jobFile, patch) {
  if (!jobFile || !fs.existsSync(jobFile)) return
  const job = JSON.parse(fs.readFileSync(jobFile, "utf8"))
  fs.writeFileSync(jobFile, `${JSON.stringify({ ...job, ...patch }, null, 2)}\n`, "utf8")
}

function readDatabaseUrl(repoRoot) {
  const envUrl = process.env.DATABASE_URL || process.env.PG_URL
  if (envUrl) return envUrl
  for (const rel of ["deploy/pm2.env", "Backend/wms-config.json", "Backend/web/wms-config.json"]) {
    const p = path.join(repoRoot, rel)
    if (!fs.existsSync(p)) continue
    if (p.endsWith(".env")) {
      const line = fs.readFileSync(p, "utf8").split(/\r?\n/).find((v) => v.startsWith("DATABASE_URL="))
      if (line) return line.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "")
    } else {
      const cfg = JSON.parse(fs.readFileSync(p, "utf8"))
      if (cfg.databaseUrl) return cfg.databaseUrl
    }
  }
  return ""
}

function findPackageDbPatches(packageRoot) {
  const dir = path.join(packageRoot, "Backend", "db", "patches")
  if (!fs.existsSync(dir)) return []
  const wanted = [
    "2026-05-26_users_password_auth.sql",
    "2026-05-26_expiry_sticker_alerts.sql",
    "2026-05-26_issue_recipient_defs.sql",
    "2026-05-22_ensure_item_groups_from_items.sql",
    "2026-05-29_receiving_reference_defaults.sql",
    "2026-05-29_wms_uom_defs.sql",
    "2026-05-29_slot_profile_equipment.sql",
  ]
  return wanted.map((name) => path.join(dir, name)).filter((p) => fs.existsSync(p))
}

function applyDbPatches(packageRoot, repoRoot, jobFile) {
  if (process.platform === "win32") return
  const patches = findPackageDbPatches(packageRoot)
  if (!patches.length) return
  const databaseUrl = readDatabaseUrl(repoRoot)
  if (!databaseUrl) {
    updateJob(jobFile, { message: "DB patches skipped: DATABASE_URL not found" })
    return
  }
  for (const patch of patches) {
    updateJob(jobFile, { message: `DB patch: ${path.basename(patch)}` })
    execSync(`psql "${databaseUrl.replace(/"/g, '\\"')}" -v ON_ERROR_STOP=0 -f "${patch}"`, {
      stdio: "inherit",
      env: { ...process.env, PGCLIENTENCODING: "UTF8" },
    })
  }
}

async function main() {
  const payload = readPayload()
  const release = payload.release
  const uiCwd = payload.uiCwd
  const repoRoot = payload.repoRoot
  const jobFile = payload.jobFile
  const updateServerUrl = (payload.updateServerUrl || "").replace(/\/$/, "")

  if (!release?.buildId || !uiCwd) {
    throw new Error("release.buildId and uiCwd are required")
  }

  updateJob(jobFile, { message: "Подготовка обновления…" })

  let packagePath = null
  const packageUrl = release.packageUrl
    ? release.packageUrl.startsWith("http")
      ? release.packageUrl
      : `${updateServerUrl}${release.packageUrl}`
    : null

  if (packageUrl) {
    updateJob(jobFile, { message: "Загрузка пакета…" })
    const tmpDir = path.join(repoRoot, ".wms-update-staging")
    fs.mkdirSync(tmpDir, { recursive: true })
    const archivePath = path.join(tmpDir, release.packageName || "release.tgz")
    await downloadFile(packageUrl, archivePath)

    updateJob(jobFile, { message: "Распаковка…" })
    const extractDir = path.join(tmpDir, "extract")
    fs.rmSync(extractDir, { recursive: true, force: true })
    fs.mkdirSync(extractDir, { recursive: true })

    extractArchive(archivePath, extractDir)
    const deployRoot = findFrontendDeployRoot(extractDir)
    const packageRoot = findPackageRoot(extractDir, deployRoot)

    if (packageRoot) {
      updateJob(jobFile, { message: "Обновление скриптов с пакета…" })
      syncPackageScripts(packageRoot, repoRoot)
      applyDbPatches(packageRoot, repoRoot, jobFile)
    }

    ensureEnvLocal(uiCwd, updateServerUrl)

    updateJob(jobFile, { message: "Копирование файлов…" })
    const envLocalPath = path.join(uiCwd, ".env.local")
    const envLocalBackup = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath) : null

    if (process.platform === "win32") {
      execSync(`robocopy "${deployRoot}" "${uiCwd}" /E /NFL /NDL /NJH /NJS /NP`, { stdio: "inherit" })
    } else {
      // Не удалять node_modules, .env.local и кэш — иначе ломается сборка и scada25-настройки.
      execSync(
        [
          "rsync -a --delete",
          '--exclude "node_modules/"',
          '--exclude ".next/"',
          '--exclude ".env.local"',
          '--exclude ".env"',
          '--exclude ".wms-update-job.json"',
          '--exclude "public/wms-build-id.json"',
          `"${deployRoot}/"`,
          `"${uiCwd}/"`,
        ].join(" "),
        { stdio: "inherit" }
      )
      // package-lock из релиза (если есть) — иначе npm install подтянет сам
      const lockSrc = path.join(deployRoot, "package-lock.json")
      if (fs.existsSync(lockSrc)) {
        fs.copyFileSync(lockSrc, path.join(uiCwd, "package-lock.json"))
      }
    }

    if (envLocalBackup) {
      fs.writeFileSync(envLocalPath, envLocalBackup)
    }

    packagePath = archivePath
    fixFrontendAfterRsync(uiCwd, repoRoot, extractDir)
  }

  writeBuildId(uiCwd, release.buildId, release.builtAt)

  const prodScript =
    (process.env.WMS_RESTART_UI_SCRIPT || "").trim() ||
    path.join(repoRoot, "scripts", "restart-wms-ui-10.26.sh")
  const fallbackScript = path.join(repoRoot, "scripts", "restart-wms-ui.sh")
  const restartScript = fs.existsSync(prodScript)
    ? prodScript
    : fs.existsSync(fallbackScript)
      ? fallbackScript
      : null
  if (restartScript && process.platform !== "win32") {
    updateJob(jobFile, { message: "Сборка и перезапуск UI…" })
    execSync(`bash "${restartScript}"`, {
      stdio: "inherit",
      cwd: repoRoot,
      env: {
        ...process.env,
        WMS_APP_BUILD_ID: release.buildId,
        WMS_APP_BUILT_AT: release.builtAt || new Date().toISOString(),
        WMS_UPDATE_SERVER_INSECURE_TLS: process.env.WMS_UPDATE_SERVER_INSECURE_TLS || "1",
      },
    })
  } else if (!packagePath) {
    updateJob(jobFile, { message: "Версия обновлена (перезагрузите dev-сервер при необходимости)" })
  }

  updateJob(jobFile, {
    status: "done",
    finishedAt: new Date().toISOString(),
    message: "Обновление завершено",
  })

  console.log(`[apply-wms-update] installed build ${release.buildId}`)
}

main().catch((err) => {
  const jobFile = process.env.WMS_UPDATE_PAYLOAD
    ? JSON.parse(process.env.WMS_UPDATE_PAYLOAD).jobFile
    : null
  if (jobFile) {
    try {
      const job = JSON.parse(fs.readFileSync(jobFile, "utf8"))
      fs.writeFileSync(
        jobFile,
        `${JSON.stringify({
          ...job,
          status: "failed",
          finishedAt: new Date().toISOString(),
          message: String(err?.message || err),
        }, null, 2)}\n`,
        "utf8"
      )
    } catch {
      /* ignore */
    }
  }
  console.error("[apply-wms-update]", err)
  process.exit(1)
})
