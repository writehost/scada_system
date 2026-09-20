#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import { createRequire } from "node:module"

const cwd = process.cwd()
const require = createRequire(import.meta.url)
const repoRoot = path.resolve(cwd, "..")
const extractRoot = path.join(repoRoot, ".wms-update-staging", "extract")

function findDirWith(relativeFile) {
  const queue = [extractRoot]
  for (let depth = 0; queue.length && depth < 8; depth += 1) {
    const n = queue.length
    for (let i = 0; i < n; i += 1) {
      const dir = queue.shift()
      if (!dir || !fs.existsSync(dir)) continue
      if (fs.existsSync(path.join(dir, relativeFile))) return dir
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) queue.push(path.join(dir, ent.name))
      }
    }
  }
  return null
}

function copyDirIfFound(relativeDir, markerFile) {
  const sourceRoot = findDirWith(path.join(relativeDir, markerFile))
  if (!sourceRoot) {
    console.log(`[prebuild-fix] source not found for ${relativeDir}/${markerFile}`)
    return false
  }
  const src = path.join(sourceRoot, relativeDir)
  const dst = path.join(cwd, relativeDir)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.cpSync(src, dst, { recursive: true })
  console.log(`[prebuild-fix] restored ${relativeDir} from ${sourceRoot}`)
  return true
}

function ensureModule(name, installSpec = name) {
  try {
    require.resolve(name, { paths: [cwd] })
    return
  } catch {
    console.log(`[prebuild-fix] installing missing ${installSpec}`)
    execSync(`npm install ${installSpec} --no-audit --no-fund --save-prod`, {
      stdio: "inherit",
      cwd,
      env: { ...process.env, npm_config_production: "false" },
    })
  }
}

if (!fs.existsSync(path.join(cwd, "components", "ui", "badge.tsx"))) {
  copyDirIfFound(path.join("components", "ui"), "badge.tsx")
}

for (const [name, spec] of [
  ["@tailwindcss/postcss", "@tailwindcss/postcss@^4.2.0"],
  ["postcss", "postcss@^8.5"],
  ["tailwindcss", "tailwindcss@^4.2.0"],
  ["tw-animate-css", "tw-animate-css@^1.3.3"],
]) {
  ensureModule(name, spec)
}

console.log("[prebuild-fix] done")
