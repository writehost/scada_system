/**
 * `cap sync` с автономным UI из `.next-tsd-export` (CAP_CLIENT_MODE=standalone).
 * Сначала: npm run build:tsd-android
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const exportDir = (process.env.TSD_EXPORT_DIR || ".next-tsd-export").replace(/\\/g, "/").replace(/\/$/, "")
const index = path.join(root, exportDir, "index.html")

if (!fs.existsSync(index)) {
  console.error(`[cap-sync-standalone] Нет ${exportDir}/index.html — сначала: npm run build:tsd-android`)
  process.exit(1)
}

const extra = process.argv.slice(2)
const cmd = extra.length ? `npx cap sync ${extra.join(" ")}` : "npx cap sync android"
const r = spawnSync(cmd, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CAP_CLIENT_MODE: "standalone" },
  shell: true,
})
process.exit(r.status ?? 1)
