/**
 * Синхронизация Android с **удалённым** dev UI (Next dev server).
 * CAP_SERVER_URL: из окружения или http://10.0.2.2:3000 (только в этом скрипте, не в capacitor.config).
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const url = (process.env.CAP_SERVER_URL || "").trim() || "http://10.0.2.2:3000"
const extra = process.argv.slice(2).join(" ")
const cmd = extra ? `npx cap sync ${extra}` : "npx cap sync android"

const r = spawnSync(cmd, {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    CAP_CLIENT_MODE: "development",
    CAP_SERVER_URL: url,
  },
})
process.exit(r.status ?? 1)
