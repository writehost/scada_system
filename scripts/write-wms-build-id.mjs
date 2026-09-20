#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

const targetDir = path.resolve(process.argv[2] || process.cwd())

function gitShortSha() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return ""
  }
}

const buildId = (process.env.WMS_APP_BUILD_ID || gitShortSha() || `dev-${Date.now().toString(36)}`).trim()
const builtAt = (process.env.WMS_APP_BUILT_AT || new Date().toISOString()).trim()

const publicDir = path.join(targetDir, "public")
fs.mkdirSync(publicDir, { recursive: true })
fs.writeFileSync(
  path.join(publicDir, "wms-build-id.json"),
  `${JSON.stringify({ buildId, builtAt }, null, 2)}\n`,
  "utf8"
)

console.log(`[wms-build-id] ${targetDir} -> ${buildId} (${builtAt})`)
