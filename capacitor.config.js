/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Capacitor: Android WebView.
 *
 * Режимы (CAP_CLIENT_MODE):
 * - standalone (по умолчанию): UI только из APK (webDir `.next-tsd-export`), **без** `server.url`.
 * - development: удалённый dev UI — **обязателен** CAP_SERVER_URL (npm run cap:sync:dev подставляет при необходимости).
 * - tsd-prod: удалённый боевой UI по HTTPS — CAP_SERVER_URL=https://…
 *
 * Псевдоним: bundled → то же, что standalone.
 */
const fs = require("node:fs")
const path = require("node:path")

let mode = (process.env.CAP_CLIENT_MODE || "standalone").trim().toLowerCase()
if (mode === "bundled") mode = "standalone"

const serverUrlRaw = (process.env.CAP_SERVER_URL || "").trim().replace(/\/$/, "")

const base = {
  appId: "com.scadatable.wms",
  appName: "SCADA WMS",
  webDir: "capacitor-assets",
}

let config

if (mode === "standalone") {
  const exportDir = (process.env.TSD_EXPORT_DIR || ".next-tsd-export").replace(/\\/g, "/").replace(/\/$/, "")
  const index = path.join(__dirname, exportDir, "index.html")
  if (!fs.existsSync(index)) {
    throw new Error(
      `standalone: нет ${exportDir}/index.html. Соберите автономный UI: npm run android:build:standalone`
    )
  }
  config = {
    ...base,
    webDir: exportDir,
  }
} else if (mode === "tsd-prod") {
  if (!serverUrlRaw) {
    throw new Error("tsd-prod: задайте CAP_SERVER_URL (HTTPS). npm run cap:sync:tsd")
  }
  if (!serverUrlRaw.startsWith("https://")) {
    throw new Error("tsd-prod: CAP_SERVER_URL должен начинаться с https://")
  }
  config = {
    ...base,
    server: {
      url: serverUrlRaw,
      cleartext: false,
      androidScheme: "https",
    },
  }
} else if (mode === "development") {
  if (!serverUrlRaw) {
    throw new Error(
      "development: задайте CAP_SERVER_URL (например http://10.0.2.2:3000 для эмулятора). Используйте: npm run cap:sync:dev"
    )
  }
  config = {
    ...base,
    server: {
      url: serverUrlRaw,
      cleartext: serverUrlRaw.startsWith("http://"),
      androidScheme: "https",
    },
  }
} else {
  throw new Error(
    `Неизвестный CAP_CLIENT_MODE="${process.env.CAP_CLIENT_MODE}". Допустимо: standalone | development | tsd-prod`
  )
}

module.exports = config
