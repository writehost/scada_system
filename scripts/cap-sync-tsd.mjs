/**
 * Синхронизация Capacitor для ТСД / прод: UI грузится с вашего WMS по HTTPS (не с ПК разработчика).
 * Запуск: CAP_SERVER_URL=https://wms.example.com npm run cap:sync:tsd
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")

const url = (process.env.CAP_SERVER_URL || "").trim()
if (!url) {
  console.error("Укажите CAP_SERVER_URL, например:")
  console.error('  set CAP_SERVER_URL=https://wms.ваш-домен.ru && npm run cap:sync:tsd')
  process.exit(1)
}
if (!url.startsWith("https://")) {
  console.error("Для ТСД ожидается HTTPS (CAP_SERVER_URL должен начинаться с https://).")
  process.exit(1)
}

const env = { ...process.env, CAP_CLIENT_MODE: "tsd-prod", CAP_SERVER_URL: url }
const extra = process.argv.slice(2).join(" ")
const cmd = extra ? `npx cap sync ${extra}` : "npx cap sync android"
const r = spawnSync(cmd, {
  cwd: root,
  stdio: "inherit",
  env,
  shell: true,
})
process.exit(r.status ?? 1)
