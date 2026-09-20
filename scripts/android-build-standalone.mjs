/**
 * Автономный Android: статический Next → cap sync (только android по умолчанию).
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")

const b = spawnSync("node", ["scripts/build-tsd-android.mjs"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
})
if (b.status !== 0) process.exit(b.status ?? 1)

const c = spawnSync("node", ["scripts/cap-sync-bundled.mjs"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
})
process.exit(c.status ?? 1)
