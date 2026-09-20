/**
 * Сборка статического `out/` для Capacitor (APK без dev-сервера для UI).
 * Временно удаляет junction `app/api/wms` и пустой `app/api/ping-db` — иначе Next
 * подхватывает route handlers и падает на `output: export`. После сборки junction создаётся снова.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const wmsJunction = path.join(root, "app", "api", "wms")
const pingDir = path.join(root, "app", "api", "ping-db")
const stashRoot = path.join(root, ".tsd-build-api-stash")
/** Реальные handlers WMS (родительский `web/app/api/wms`). */
const wmsTarget = path.resolve(root, "..", "app", "api", "wms")
/** Локальные route handlers — не нужны в статическом APK, ломают `output: export`. */
const stashedApiPaths = ["app/api/app", "app/api/auth", "app/wms-item-images"]

function removeIfExists(p) {
  if (!fs.existsSync(p)) return
  fs.rmSync(p, { recursive: true, force: true })
}

function stashLocalApiRoutes() {
  fs.mkdirSync(stashRoot, { recursive: true })
  for (const rel of stashedApiPaths) {
    const src = path.join(root, rel)
    if (!fs.existsSync(src)) continue
    const dest = path.join(stashRoot, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    removeIfExists(dest)
    fs.renameSync(src, dest)
  }
}

function restoreLocalApiRoutes() {
  for (const rel of stashedApiPaths) {
    const src = path.join(stashRoot, rel)
    const dest = path.join(root, rel)
    if (!fs.existsSync(src)) continue
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    removeIfExists(dest)
    fs.renameSync(src, dest)
  }
  removeIfExists(stashRoot)
}

function recreateWmsJunction() {
  const apiRoot = path.join(root, "app", "api")
  fs.mkdirSync(apiRoot, { recursive: true })
  if (!fs.existsSync(wmsTarget)) {
    console.warn("[build-tsd-android] Нет цели для junction:", wmsTarget, "— пропуск восстановления wms.")
    return
  }
  if (fs.existsSync(wmsJunction)) return
  if (process.platform === "win32") {
    const r = spawnSync(
      "cmd",
      ["/c", "mklink", "/J", wmsJunction, wmsTarget],
      { cwd: root, stdio: "inherit", shell: false }
    )
    if (r.status !== 0) {
      console.error(
        "[build-tsd-android] mklink не удался. Создайте вручную: mklink /J app\\api\\wms ..\\app\\api\\wms"
      )
    }
  } else {
    try {
      fs.symlinkSync(wmsTarget, wmsJunction, "dir")
    } catch (e) {
      console.error("[build-tsd-android] symlink app/api/wms:", e)
    }
  }
}

removeIfExists(wmsJunction)
removeIfExists(pingDir)
stashLocalApiRoutes()

let exitCode = 1
try {
  const r = spawnSync("npx", ["next", "build", "--webpack"], {
    cwd: root,
    env: { ...process.env, TSD_ANDROID_BUNDLE: "1" },
    stdio: "inherit",
    shell: true,
  })
  exitCode = r.status ?? 1
} finally {
  restoreLocalApiRoutes()
  recreateWmsJunction()
}

process.exit(exitCode)
