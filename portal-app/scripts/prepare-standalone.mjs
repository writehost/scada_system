// Копирует статику и public в .next/standalone — после этого каталог выкладывается целиком.
import { cpSync, existsSync } from "node:fs"

if (!existsSync(".next/standalone")) {
  console.error("Нет .next/standalone — сначала npm run build")
  process.exit(1)
}
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true })
cpSync("public", ".next/standalone/public", { recursive: true })
console.log("standalone готов: node .next/standalone/server.js")
